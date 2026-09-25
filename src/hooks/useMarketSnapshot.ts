import { useCallback, useMemo, useSyncExternalStore } from "react";

const MARKET_API =
  (import.meta.env.VITE_MARKET_API as string | undefined) ??
  "http://localhost:8787";

export type Region = "india" | "world";

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
  provider: string;
  asOf: string | null;
  stale: boolean;
  budget: { used: number; limit: number; remaining: number } | null;
  regions: Partial<Record<Region, RegionSnapshot>>;
}

export const REGION_LABELS: Record<Region, string> = {
  india: "India",
  world: "World",
};

export const money = (ticker: Ticker): string => {
  const symbol =
    ticker.currency === "INR" ? "₹" : ticker.currency === "USD" ? "$" : "";
  const locale = ticker.currency === "INR" ? "en-IN" : "en-US";
  return symbol
    ? `${symbol}${ticker.price.toLocaleString(locale)}`
    : `${ticker.currency} ${ticker.price.toLocaleString(locale)}`;
};

// ─────────── shared store: one cache, one request, one timer for every component ───────────

interface StoreState {
  snapshot: MarketSnapshot | null;
  error: string | null;
  fetchedAt: number;
}

let state: StoreState = { snapshot: null, error: null, fetchedAt: 0 };
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const setState = (next: Partial<StoreState>): void => {
  state = { ...state, ...next }; // new object only when data changes, so useSyncExternalStore re-renders
  listeners.forEach((notify) => notify());
};

/** Fetch unless a request is already running. Every caller shares the same promise. */
function load(): Promise<void> {
  inFlight ??= fetch(`${MARKET_API}/api/market/snapshot`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState({
        snapshot: (await response.json()) as MarketSnapshot,
        error: null,
        fetchedAt: Date.now(),
      });
    })
    .catch((err: unknown) =>
      setState({ error: (err as Error).message, fetchedAt: Date.now() }),
    )
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Load only if the cached snapshot is older than maxAgeMs — remounts and StrictMode reuse the cache. */
function loadIfStale(maxAgeMs: number): void {
  if (Date.now() - state.fetchedAt >= maxAgeMs) void load();
}

function subscribe(notify: () => void, refreshMs: number): () => void {
  listeners.add(notify);
  loadIfStale(refreshMs);
  // One timer for all subscribers; skip polling while the tab is hidden.
  timer ??= setInterval(() => {
    if (document.visibilityState === "visible") loadIfStale(refreshMs);
  }, refreshMs);

  return () => {
    listeners.delete(notify);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getState = (): StoreState => state;

/**
 * One fetch for both regions, shared by the marquee and the movers panel.
 * Components can mount, unmount and re-render freely: the request is deduped and cached
 * for refreshMs, and polling runs once for the whole app (paused while the tab is hidden).
 */
export function useMarketSnapshot(refreshMs = 60_000) {
  // Stable subscribe (only changes if refreshMs does), so React doesn't resubscribe on every render.
  const subscribeWithRefresh = useCallback(
    (notify: () => void) => subscribe(notify, refreshMs),
    [refreshMs],
  );
  const { snapshot, error } = useSyncExternalStore(
    subscribeWithRefresh,
    getState,
    getState,
  );

  /** Force a fresh fetch (e.g. a "Refresh" button), still deduped with any request in flight. */
  const refresh = useCallback(() => load(), []);

  return useMemo(
    () => ({ snapshot, error, refresh }),
    [snapshot, error, refresh],
  );
}
