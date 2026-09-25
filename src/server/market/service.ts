/**
 * Market snapshots for India and the world, provider-agnostic.
 * src/server/market/service.ts
 *
 * Choose the provider with MARKET_PROVIDER=yahoo | twelve-data | alpha-vantage.
 * Quotes are batched in one call; sparklines are fetched only for the movers
 * that are actually rendered, and cached far longer than quotes.
 */
import { alphaVantageProvider } from "./providers/alphaVantage.js";
import { twelveDataProvider } from "./providers/twelveData.js";
import { yahooProvider } from "./providers/yahoo.js";
import type { MarketProvider, ProviderName, Quote } from "./providers/types.js";
import {
  INDICES,
  REGIONS,
  WATCHLISTS,
  type Region,
  type WatchEntry,
} from "./watchlists.js";

const PROVIDERS: Record<ProviderName, MarketProvider> = {
  yahoo: yahooProvider,
  "twelve-data": twelveDataProvider,
  "alpha-vantage": alphaVantageProvider,
};

const ACTIVE = (process.env.MARKET_PROVIDER ?? "yahoo") as ProviderName;
const provider = PROVIDERS[ACTIVE] ?? yahooProvider;

const QUOTE_TTL_MS = Number(process.env.MARKET_QUOTE_TTL_MS ?? 120_000);
const SERIES_TTL_MS = Number(
  process.env.MARKET_SERIES_TTL_MS ?? 6 * 60 * 60 * 1000,
);
const SPARK_COUNT = 5; // sparklines fetched per list, top movers only

export interface Ticker {
  id: string;
  name: string;
  price: number;
  changePct: number;
  currency: string;
  asOf: string;
  live: boolean;
  spark: number[];
}

export interface RegionSnapshot {
  region: Region;
  indices: Ticker[];
  tickers: Ticker[];
  gainers: Ticker[];
  losers: Ticker[];
}

export interface MarketSnapshot {
  provider: ProviderName;
  asOf: string | null;
  stale: boolean;
  budget: { used: number; limit: number; remaining: number } | null;
  regions: Partial<Record<Region, RegionSnapshot>>;
}

const symbolOf = (entry: WatchEntry): string | undefined =>
  entry.symbols[provider.name];

const seriesCache = new Map<string, { at: number; closes: number[] }>();
const regionCache = new Map<Region, { at: number; data: RegionSnapshot }>();
const inFlight = new Map<Region, Promise<RegionSnapshot>>();

async function sparkFor(symbol: string): Promise<number[]> {
  const cached = seriesCache.get(symbol);
  if (cached && Date.now() - cached.at < SERIES_TTL_MS) return cached.closes;
  try {
    const closes = await provider.getSeries(symbol, 30);
    seriesCache.set(symbol, { at: Date.now(), closes });
    return closes;
  } catch {
    return cached?.closes ?? [];
  }
}

function toTicker(entry: WatchEntry, quote: Quote): Ticker {
  return {
    id: entry.id,
    name: entry.name,
    price: Number(quote.price.toFixed(2)),
    changePct: Number(quote.changePct.toFixed(2)),
    currency: quote.currency,
    asOf: quote.asOf,
    live: quote.live,
    spark: quote.spark ?? [],
  };
}

async function buildRegion(region: Region): Promise<RegionSnapshot> {
  const entries = [...INDICES[region], ...WATCHLISTS[region]].filter((entry) =>
    symbolOf(entry),
  );
  const symbols = entries.map((entry) => symbolOf(entry)!);

  const quotes = await provider.getQuotes(symbols);
  // Providers skip failing symbols instead of throwing, so "nothing came back" is the
  // real failure signal (e.g. Yahoo rate-limiting). Throw so we keep the last good data.
  if (symbols.length && !quotes.length) {
    throw new Error(`${provider.name} returned no quotes (rate-limited or unavailable)`);
  }
  const bySymbol = new Map(
    quotes.map((quote) => [quote.symbol.toUpperCase(), quote]),
  );

  const resolve = (list: WatchEntry[]): Ticker[] =>
    list
      .map((entry) => {
        const quote = bySymbol.get(symbolOf(entry)!.toUpperCase());
        return quote ? toTicker(entry, quote) : null;
      })
      .filter((ticker): ticker is Ticker => ticker !== null);

  const indices = resolve(INDICES[region].filter((entry) => symbolOf(entry)));
  const tickers = resolve(
    WATCHLISTS[region].filter((entry) => symbolOf(entry)),
  );

  const ranked = [...tickers].sort((a, b) => b.changePct - a.changePct);
  const gainers = ranked.filter((t) => t.changePct > 0).slice(0, 10);
  const losers = ranked
    .filter((t) => t.changePct < 0)
    .reverse()
    .slice(0, 10);

  // Only when the provider didn't return history with the quote (Twelve Data,
  // Alpha Vantage). Yahoo's chart endpoint already included it.
  const needSpark = [
    ...gainers.slice(0, SPARK_COUNT),
    ...losers.slice(0, SPARK_COUNT),
  ].filter((ticker) => ticker.spark.length === 0);
  for (const ticker of needSpark) {
    const entry = WATCHLISTS[region].find((w) => w.id === ticker.id);
    if (entry) ticker.spark = await sparkFor(symbolOf(entry)!);
  }

  return { region, indices, tickers, gainers, losers };
}

/**
 * After a failed refresh, don't call the provider again until the backoff expires:
 * 1 min, then 2, 4, 8, capped at 15 min. Every caller in that window (UI polls,
 * agent tool calls) gets the last good data or the remembered error — no new requests.
 */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const failures = new Map<Region, { until: number; count: number; error: Error }>();

async function getRegion(region: Region): Promise<RegionSnapshot> {
  const cached = regionCache.get(region);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.data;

  const failure = failures.get(region);
  if (failure && Date.now() < failure.until) {
    if (cached) return cached.data; // stale but real
    throw failure.error;
  }

  let pending = inFlight.get(region);
  if (!pending) {
    pending = buildRegion(region)
      .then((data) => {
        regionCache.set(region, { at: Date.now(), data });
        failures.delete(region);
        return data;
      })
      .catch((error: Error) => {
        const count = (failures.get(region)?.count ?? 0) + 1;
        const wait = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
        failures.set(region, { until: Date.now() + wait, count, error });
        console.warn(`[market] ${region}: ${error.message} — next try in ${Math.round(wait / 1000)}s`);
        throw error;
      })
      .finally(() => inFlight.delete(region));
    inFlight.set(region, pending);
  }

  try {
    return await pending;
  } catch (error) {
    if (cached) return cached.data; // serve stale rather than fail
    throw error;
  }
}

export async function getSnapshot(
  regions: Region[] = REGIONS,
): Promise<MarketSnapshot> {
  // Sequential on purpose: two regions in parallel is a 36-request burst, which
  // is exactly what gets you rate-limited.
  const results: PromiseSettledResult<RegionSnapshot>[] = [];
  for (const region of regions) {
    try {
      results.push({ status: "fulfilled", value: await getRegion(region) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }

  const snapshot: MarketSnapshot = {
    provider: provider.name,
    asOf: null,
    stale: results.some((r) => r.status === "rejected"),
    budget: provider.budget?.() ?? null,
    regions: {},
  };

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    snapshot.regions[result.value.region] = result.value;
    snapshot.asOf ??= result.value.tickers[0]?.asOf ?? null;
  }

  return snapshot;
}

export { REGIONS, type Region };
