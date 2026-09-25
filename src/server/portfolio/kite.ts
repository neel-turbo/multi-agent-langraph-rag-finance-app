/**
 * The user's holdings from Zerodha Kite, as JSON.
 * src/server/portfolio/kite.ts
 *
 * Default: Kite's public demo account (https://kite-demo.zerodha.com), which hands out an
 * anonymous DEMOUSER session and serves the same JSON shape as Kite Connect. Its prices
 * are a fixed snapshot, not live.
 *
 * Real account: set KITE_API_KEY and KITE_ACCESS_TOKEN (from the Kite Connect login flow)
 * and the same code reads https://api.kite.trade/portfolio/holdings instead.
 */
import type { Holding, PortfolioSnapshot, PortfolioTotals } from "../../shared/types.js";

const API_KEY = process.env.KITE_API_KEY;
const ACCESS_TOKEN = process.env.KITE_ACCESS_TOKEN;
const LIVE = Boolean(API_KEY && ACCESS_TOKEN);

const HOLDINGS_URL = LIVE
  ? "https://api.kite.trade/portfolio/holdings"
  : `${process.env.KITE_DEMO_URL ?? "https://kite-demo.zerodha.com"}/oms/portfolio/holdings`;
const SOURCE = LIVE ? "Zerodha Kite" : "Zerodha Kite demo";
const DEMO_ACCOUNT = "DEMOUSER";

const TTL_MS = Number(process.env.KITE_TTL_MS ?? 60_000);
const TIMEOUT_MS = 10_000;

/** The fields we read from a Kite holding; the API returns many more. */
interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1_quantity?: number;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number; // per share
  day_change_percentage: number;
}

interface KiteResponse {
  status: "success" | "error";
  message?: string;
  data: KiteHolding[] | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const pct = (part: number, whole: number): number => (whole ? round2((part / whole) * 100) : 0);

function toSnapshot(rows: KiteHolding[]): PortfolioSnapshot {
  const base = rows
    .map((row) => {
      const quantity = row.quantity + (row.t1_quantity ?? 0); // T+1 shares are owned, just not settled
      const invested = quantity * row.average_price;
      const currentValue = quantity * row.last_price;
      return {
        symbol: row.tradingsymbol,
        exchange: row.exchange,
        isin: row.isin,
        quantity,
        averagePrice: round2(row.average_price),
        lastPrice: round2(row.last_price),
        closePrice: round2(row.close_price),
        invested: round2(invested),
        currentValue: round2(currentValue),
        pnl: round2(currentValue - invested),
        pnlPct: pct(currentValue - invested, invested),
        dayChange: round2(row.day_change * quantity),
        dayChangePct: round2(row.day_change_percentage),
      };
    })
    .filter((row) => row.quantity > 0);

  const invested = base.reduce((sum, h) => sum + h.invested, 0);
  const currentValue = base.reduce((sum, h) => sum + h.currentValue, 0);
  const dayChange = base.reduce((sum, h) => sum + h.dayChange, 0);

  const holdings: Holding[] = base
    .map((h) => ({ ...h, weightPct: pct(h.currentValue, currentValue) }))
    .sort((a, b) => b.currentValue - a.currentValue);

  const totals: PortfolioTotals = {
    invested: round2(invested),
    currentValue: round2(currentValue),
    pnl: round2(currentValue - invested),
    pnlPct: pct(currentValue - invested, invested),
    dayChange: round2(dayChange),
    dayChangePct: pct(dayChange, currentValue - dayChange),
  };

  return {
    source: SOURCE,
    accountId: LIVE ? null : DEMO_ACCOUNT,
    fetchedAt: new Date().toISOString(),
    holdings,
    totals,
  };
}

async function fetchHoldings(): Promise<PortfolioSnapshot> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Kite-Version": "3" };
  if (LIVE) headers.Authorization = `token ${API_KEY}:${ACCESS_TOKEN}`;

  const response = await fetch(HOLDINGS_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await response.json().catch(() => null)) as KiteResponse | null;
  if (!response.ok || body?.status !== "success" || !Array.isArray(body.data)) {
    throw new Error(`Kite holdings: ${body?.message ?? `HTTP ${response.status}`}`);
  }
  return toSnapshot(body.data);
}

let cached: { snapshot: PortfolioSnapshot; at: number } | null = null;
let inFlight: Promise<PortfolioSnapshot> | null = null;

/** Holdings, cached for KITE_TTL_MS; concurrent callers share one request. */
export async function getPortfolio(): Promise<PortfolioSnapshot> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  inFlight ??= fetchHoldings()
    .then((snapshot) => {
      cached = { snapshot, at: Date.now() };
      return snapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Kite exchange → Yahoo suffix, for price history of a holding. */
export const yahooSymbol = (symbol: string, exchange: string): string =>
  `${symbol}${exchange === "BSE" ? ".BO" : ".NS"}`;
