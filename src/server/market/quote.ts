/**
 * Single-symbol lookup for the agent, for anything outside the watchlists.
 * src/server/market/quote.ts
 */
import { alphaVantageProvider } from "./providers/alphaVantage.js";
import { twelveDataProvider } from "./providers/twelveData.js";
import { yahooProvider } from "./providers/yahoo.js";
import type { MarketProvider, ProviderName } from "./providers/types.js";

const PROVIDERS: Record<ProviderName, MarketProvider> = {
  yahoo: yahooProvider,
  "twelve-data": twelveDataProvider,
  "alpha-vantage": alphaVantageProvider,
};

const provider = PROVIDERS[(process.env.MARKET_PROVIDER ?? "yahoo") as ProviderName] ?? yahooProvider;

export async function getQuoteWithHistory(symbol: string): Promise<string> {
  const [quote] = await provider.getQuotes([symbol]);
  if (!quote) return `No data found for ${symbol}. Check the symbol suffix (.NS for NSE, .BO for BSE).`;

  const closes = await provider.getSeries(symbol, 30).catch(() => []);
  const range = closes.length
    ? ` Range over the last ${closes.length} sessions: ${Math.min(...closes).toFixed(2)} to ${Math.max(...closes).toFixed(2)}.`
    : "";

  const direction = quote.changePct >= 0 ? "up" : "down";
  const freshness = quote.live ? "trading now" : `last close ${quote.asOf}`;

  return (
    `${quote.name} (${quote.symbol}): ${quote.currency} ${quote.price.toLocaleString()}, ` +
    `${direction} ${Math.abs(quote.changePct).toFixed(2)}% — ${freshness}.${range}`
  );
}
