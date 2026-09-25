/**
 * Provider-agnostic market data contract.
 * src/server/market/providers/types.ts
 *
 * Everything above this layer (service, tools, UI) speaks only Quote, so
 * swapping Yahoo for Twelve Data is an env var, not a refactor.
 */
export interface Quote {
  symbol: string; // provider symbol, e.g. RELIANCE.NS
  name: string;
  price: number;
  previousClose: number;
  changePct: number;
  currency: string;
  asOf: string; // ISO date of the data
  live: boolean; // true for intraday, false for end-of-day
  spark?: number[]; // recent closes, when the provider returns them for free
}

export interface MarketProvider {
  readonly name: ProviderName;
  /** Batched where the API supports it. Unknown symbols are skipped, not thrown. */
  getQuotes(symbols: string[], points?: number): Promise<Quote[]>;
  /** Recent daily closes, oldest first, for the sparkline. */
  getSeries(symbol: string, points?: number): Promise<number[]>;
  /** Rough call budget info for the UI, when the provider has a hard cap. */
  budget?(): { used: number; limit: number; remaining: number };
}

export type ProviderName = "yahoo" | "twelve-data" | "alpha-vantage";
