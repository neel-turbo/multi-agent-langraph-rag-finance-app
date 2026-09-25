/**
 * Small HTTP API for the browser. No framework — node:http is enough for two routes.
 * src/server/api/server.ts
 *
 *   GET /api/market/snapshot                 both regions
 *   GET /api/market/snapshot?region=india    one region (india | world)
 *   GET /api/portfolio                       the user's holdings (Zerodha Kite)
 *   GET /api/portfolio/history?symbol=SBIN&exchange=NSE   daily closes for one holding
 *   GET /api/health
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { getSnapshot, REGIONS, type Region } from "../market/service.js";
import { getHistory } from "../market/providers/yahoo.js";
import { getPortfolio, yahooSymbol } from "../portfolio/kite.js";
import type { PriceHistory } from "../../shared/types.js";

const SYMBOL = /^[A-Z0-9&_-]{1,30}$/;

const PORT = Number(process.env.MARKET_API_PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    send(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/api/market/snapshot") {
    try {
      const requested = url.searchParams.get("region") as Region | null;
      const regions = requested && REGIONS.includes(requested) ? [requested] : REGIONS;
      const snapshot = await getSnapshot(regions);
      send(res, 200, snapshot);
    } catch (error) {
      send(res, 502, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/portfolio") {
    try {
      send(res, 200, await getPortfolio());
    } catch (error) {
      send(res, 502, { error: (error as Error).message });
    }
    return;
  }

  if (url.pathname === "/api/portfolio/history") {
    const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
    const exchange = (url.searchParams.get("exchange") ?? "NSE").toUpperCase();
    if (!SYMBOL.test(symbol)) {
      send(res, 400, { error: "symbol is required, e.g. ?symbol=SBIN&exchange=NSE" });
      return;
    }
    try {
      const providerSymbol = yahooSymbol(symbol, exchange);
      const body: PriceHistory = { symbol: providerSymbol, points: await getHistory(providerSymbol, 120) };
      send(res, 200, body);
    } catch (error) {
      send(res, 502, { error: (error as Error).message });
    }
    return;
  }

  send(res, 404, { error: "Not found" });
}

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => send(res, 500, { error: String(error) }));
}).listen(PORT, () => {
  console.log(`[api] market API on http://localhost:${PORT}`);
});
