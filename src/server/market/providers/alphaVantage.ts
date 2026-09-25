/**
 * Alpha Vantage behind the provider interface.
 * src/server/market/providers/alphaVantage.ts
 *
 * Kept because its 50+ technical indicators and fundamentals are genuinely good.
 * As a quote source it is the weakest option here: 25 calls/day, end-of-day only,
 * and no batching — one HTTP call per symbol.
 */
import { budgetStatus, getDailySeries } from "../alphaVantage.js";
import type { MarketProvider, Quote } from "./types.js";

export const alphaVantageProvider: MarketProvider = {
  name: "alpha-vantage",

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const quotes: Quote[] = [];
    for (const symbol of symbols) {
      try {
        const series = await getDailySeries(symbol);
        if (!series) continue;
        quotes.push({
          symbol,
          name: symbol.replace(/\.(BSE|NSE)$/, ""),
          price: series.lastClose,
          previousClose: series.previousClose,
          changePct: series.changePct,
          currency: symbol.endsWith(".BSE") ? "INR" : "USD",
          asOf: series.asOf,
          live: false,
        });
      } catch (error) {
        console.warn(`[alpha-vantage] ${symbol}: ${(error as Error).message}`);
      }
    }
    return quotes;
  },

  async getSeries(symbol: string, points = 30): Promise<number[]> {
    const series = await getDailySeries(symbol);
    return series ? series.closes.slice(-points) : [];
  },

  budget: budgetStatus,
};
