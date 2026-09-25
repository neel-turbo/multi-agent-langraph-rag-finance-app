/**
 * Yahoo Finance provider — no API key, covers NSE (.NS), BSE (.BO), US, Europe,
 * Asia and indices (^NSEI, ^GSPC, ...).
 * src/server/market/providers/yahoo.ts
 *
 * Why chart() and not quote():
 *   Yahoo now guards the quote endpoint with a crumb/cookie and returns
 *   "Too Many Requests" quickly. The chart endpoint is far more tolerant AND
 *   returns the price and the history in one call, so a symbol costs one
 *   request instead of two.
 *
 * Requests are throttled and retried with backoff, and a failing symbol is
 * skipped rather than failing the whole batch.
 */
import YahooFinance from "yahoo-finance2";

import type { MarketProvider, Quote } from "./types.js";

// v3: the default export is a class — one client per app, options go to the constructor.
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const CONCURRENCY = Number(process.env.YAHOO_CONCURRENCY ?? 2);
const MIN_GAP_MS = Number(process.env.YAHOO_MIN_GAP_MS ?? 250);
const RETRY_DELAYS_MS = [700, 2_000, 5_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let nextSlot = 0;
/** Global spacing between outbound calls, across regions and callers. */
async function takeSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await sleep(at - now);
}

const isRateLimit = (error: unknown): boolean =>
  /too many requests|429/i.test((error as Error)?.message ?? "");

interface ChartResult {
  meta: {
    symbol?: string;
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    currency?: string;
    regularMarketTime?: Date | number;
    marketState?: string;
  };
  quotes: { date: Date; close: number | null }[];
}

async function fetchChart(symbol: string, points: number): Promise<ChartResult | null> {
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(points * 1.6) - 5); // pad for weekends/holidays

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    await takeSlot();
    try {
      return (await yahooFinance.chart(
        symbol,
        { period1: start, interval: "1d" },
        { validateResult: false } // Yahoo adds fields faster than the library's schema
      )) as unknown as ChartResult;
    } catch (error) {
      const last = attempt === RETRY_DELAYS_MS.length;
      if (last || !isRateLimit(error)) {
        console.warn(`[yahoo] ${symbol}: ${(error as Error).message}`);
        return null;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return null;
}

function toIsoDate(value: Date | number | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value * 1000);
  return date.toISOString().slice(0, 10);
}

function toQuote(symbol: string, chart: ChartResult, points: number): Quote | null {
  const closes = chart.quotes
    .map((bar) => bar.close)
    .filter((close): close is number => typeof close === "number");

  const price = chart.meta.regularMarketPrice ?? closes[closes.length - 1];
  if (typeof price !== "number") return null;

  // Day change is vs the previous session's bar. chartPreviousClose is the close *before the
  // chart window* (~50 days back), so using it first reported multi-week moves as "today".
  const previousClose =
    closes[closes.length - 2] ?? chart.meta.previousClose ?? chart.meta.chartPreviousClose ?? price;

  return {
    symbol: chart.meta.symbol ?? symbol,
    name: chart.meta.shortName ?? chart.meta.longName ?? symbol,
    price,
    previousClose,
    changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
    currency: chart.meta.currency ?? "USD",
    asOf: toIsoDate(chart.meta.regularMarketTime),
    live: chart.meta.marketState === "REGULAR",
    spark: closes.slice(-points),
  };
}

/** Run tasks a few at a time instead of all at once. */
async function pooled<T>(items: string[], worker: (item: string) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  const queue = [...items];

  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      results.push(await worker(item));
    }
  });

  await Promise.all(runners);
  return results;
}

/** Daily closes with their dates, oldest first — for full-size charts, not sparklines. */
export async function getHistory(symbol: string, points = 120): Promise<{ date: string; close: number }[]> {
  const chart = await fetchChart(symbol, points);
  if (!chart) return [];
  return chart.quotes
    .filter((bar) => typeof bar.close === "number")
    .map((bar) => ({ date: toIsoDate(bar.date), close: bar.close as number }))
    .slice(-points);
}

export const yahooProvider: MarketProvider = {
  name: "yahoo",

  async getQuotes(symbols: string[], points = 30): Promise<Quote[]> {
    if (!symbols.length) return [];

    const quotes = await pooled(symbols, async (symbol) => {
      const chart = await fetchChart(symbol, points);
      return chart ? toQuote(symbol, chart, points) : null;
    });

    return quotes.filter((quote): quote is Quote => quote !== null);
  },

  async getSeries(symbol: string, points = 30): Promise<number[]> {
    const chart = await fetchChart(symbol, points);
    if (!chart) return [];
    return chart.quotes
      .map((bar) => bar.close)
      .filter((close): close is number => typeof close === "number")
      .slice(-points);
  },
};
