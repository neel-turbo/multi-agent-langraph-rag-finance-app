/**
 * Alpha Vantage client built for the free tier: 25 requests/day, 5/minute.
 * src/server/market/alphaVantage.ts
 *
 * Key decision: we use TIME_SERIES_DAILY only. One call returns both the latest
 * close AND the history for a sparkline, so a watchlist of N symbols costs N
 * calls instead of 2N. GLOBAL_QUOTE is used only on premium keys.
 *
 * The cache and the day's budget are persisted to disk, so restarting the
 * server does not burn the daily allowance again.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";
const BASE_URL = "https://www.alphavantage.co/query";
const DAILY_BUDGET = Number(process.env.ALPHA_VANTAGE_DAILY_BUDGET ?? 25);
const MIN_INTERVAL_MS = Number(process.env.ALPHA_VANTAGE_MIN_INTERVAL_MS ?? 13_000); // 5/min
const CACHE_TTL_MS = Number(process.env.ALPHA_VANTAGE_TTL_MS ?? 12 * 60 * 60 * 1000);
const CACHE_FILE = path.resolve(process.env.MARKET_CACHE_FILE ?? "./data/market-cache.json");

export interface DailySeries {
  symbol: string;
  dates: string[]; // oldest -> newest
  closes: number[];
  lastClose: number;
  previousClose: number;
  changePct: number;
  asOf: string;
}

interface CacheEntry {
  at: number;
  data: DailySeries;
}

interface CacheFile {
  budgetDate: string;
  budgetUsed: number;
  entries: Record<string, CacheEntry>;
}

let cache: CacheFile = { budgetDate: today(), budgetUsed: 0, entries: {} };
let loaded = false;
let lastCallAt = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, "utf8")) as CacheFile;
  } catch {
    // no cache yet — fine
  }
  if (cache.budgetDate !== today()) {
    cache.budgetDate = today();
    cache.budgetUsed = 0;
  }
}

async function saveCache(): Promise<void> {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
}

export function budgetStatus(): { used: number; limit: number; remaining: number } {
  return {
    used: cache.budgetUsed,
    limit: DAILY_BUDGET,
    remaining: Math.max(0, DAILY_BUDGET - cache.budgetUsed),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Alpha Vantage returns 200 with an explanatory key instead of an HTTP error. */
function assertNoApiError(payload: Record<string, unknown>, symbol: string): void {
  const message =
    (payload["Error Message"] as string) ??
    (payload["Note"] as string) ??
    (payload["Information"] as string);
  if (message) throw new Error(`Alpha Vantage (${symbol}): ${message}`);
}

function parseDaily(symbol: string, payload: Record<string, unknown>): DailySeries {
  const series = payload["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
  if (!series) throw new Error(`No daily series for ${symbol}`);

  const dates = Object.keys(series).sort(); // oldest -> newest
  const closes = dates.map((date) => Number(series[date]["4. close"]));
  const lastClose = closes[closes.length - 1];
  const previousClose = closes[closes.length - 2] ?? lastClose;

  return {
    symbol,
    dates: dates.slice(-30),
    closes: closes.slice(-30),
    lastClose,
    previousClose,
    changePct: previousClose ? ((lastClose - previousClose) / previousClose) * 100 : 0,
    asOf: dates[dates.length - 1],
  };
}

export interface FetchOptions {
  /** Return stale cache instead of spending budget. */
  cacheOnly?: boolean;
}

/**
 * Daily series for one symbol. Returns null when nothing is cached and the
 * budget is spent — callers should show stale data rather than fail.
 */
export async function getDailySeries(
  symbol: string,
  { cacheOnly = false }: FetchOptions = {}
): Promise<DailySeries | null> {
  await loadCache();

  const entry = cache.entries[symbol];
  const fresh = entry && Date.now() - entry.at < CACHE_TTL_MS;
  if (fresh || cacheOnly) return entry?.data ?? null;

  if (!API_KEY) throw new Error("ALPHA_VANTAGE_API_KEY is not set");
  if (cache.budgetUsed >= DAILY_BUDGET) return entry?.data ?? null; // stale or nothing

  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);

  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    symbol
  )}&outputsize=compact&apikey=${API_KEY}`;

  lastCallAt = Date.now();
  cache.budgetUsed += 1;

  const response = await fetch(url);
  const payload = (await response.json()) as Record<string, unknown>;
  assertNoApiError(payload, symbol);

  const data = parseDaily(symbol, payload);
  cache.entries[symbol] = { at: Date.now(), data };
  await saveCache();
  return data;
}
