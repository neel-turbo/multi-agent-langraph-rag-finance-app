/**
 * Market data tools for the market agent (India + world).
 * src/server/tools/marketTools.ts
 *
 * These read the SAME cached snapshot the UI uses, so agent questions usually
 * cost no extra provider calls.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getSnapshot, type Region, type Ticker } from "../market/service.js";
import { WATCHLISTS } from "../market/watchlists.js";

const moversSchema = z.object({
  region: z.enum(["india", "world", "both"]).describe("Which market to report on."),
});

const money = (t: Ticker): string =>
  `${t.currency === "INR" ? "₹" : t.currency === "USD" ? "$" : t.currency + " "}${t.price.toLocaleString()}`;

const formatList = (label: string, rows: Ticker[]): string =>
  rows.length
    ? `${label}:\n` +
      rows
        .map((t) => `- ${t.name} (${t.id}): ${money(t)}, ${t.changePct > 0 ? "+" : ""}${t.changePct}%`)
        .join("\n")
    : `${label}: none today.`;

export const marketMovers = tool(
  async ({ region }: z.infer<typeof moversSchema>): Promise<string> => {
    const regions: Region[] = region === "both" ? ["india", "world"] : [region];
    const snapshot = await getSnapshot(regions);

    const sections = regions.map((key) => {
      const data = snapshot.regions[key];
      if (!data) return `${key}: data unavailable.`;

      const indices = data.indices
        .map((i) => `${i.name} ${i.price.toLocaleString()} (${i.changePct > 0 ? "+" : ""}${i.changePct}%)`)
        .join(", ");

      return [
        `## ${key === "india" ? "India" : "World"} — ${data.tickers[0]?.live ? "live" : "last close"} ${data.tickers[0]?.asOf ?? ""}`,
        indices ? `Indices: ${indices}` : "",
        formatList("Top gainers", data.gainers),
        formatList("Top losers", data.losers),
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      `Source: ${snapshot.provider}. Movers are ranked within a ${WATCHLISTS.india.length}-stock watchlist per region, not the whole market.`,
      ...sections,
    ].join("\n\n");
  },
  {
    name: "market_movers",
    description:
      "Index levels plus top gainers and losers for the Indian market, world markets, or both. " +
      "Always state the date and that the ranking covers a watchlist, not the entire market.",
    schema: moversSchema,
  }
);

const quoteSchema = z.object({
  symbol: z
    .string()
    .describe("Provider symbol: RELIANCE.NS or TCS.NS for India, AAPL or 7203.T for world markets."),
});

export const stockQuote = tool(
  async ({ symbol }: z.infer<typeof quoteSchema>): Promise<string> => {
    const { getQuoteWithHistory } = await import("../market/quote.js");
    try {
      return await getQuoteWithHistory(symbol.toUpperCase());
    } catch (error) {
      return `Could not fetch ${symbol}: ${(error as Error).message}`;
    }
  },
  {
    name: "stock_quote",
    description:
      "Price and recent range for one stock or index, Indian or global. " +
      "Say whether the figure is live or a previous close, and give the date.",
    schema: quoteSchema,
  }
);
