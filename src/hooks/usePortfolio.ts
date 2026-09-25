import { useCallback, useEffect, useState } from "react";

import type { PortfolioSnapshot, PriceHistory } from "../shared/types.js";

const MARKET_API =
  (import.meta.env.VITE_MARKET_API as string | undefined) ??
  "http://localhost:8787";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${MARKET_API}${path}`, { signal });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !body)
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useJson<T>(path: string | null) {
  const [state, setState] = useState<Loadable<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: null }));
    getJson<T>(path, controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error: (error as Error).message,
            loading: false,
          });
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

/** The user's holdings from Zerodha Kite, via the API server. */
export const usePortfolio = () => useJson<PortfolioSnapshot>("/api/portfolio");

/** Daily closes for one holding; pass null to load nothing. */
export const usePriceHistory = (
  holding: { symbol: string; exchange: string } | null,
) =>
  useJson<PriceHistory>(
    holding
      ? `/api/portfolio/history?symbol=${encodeURIComponent(holding.symbol)}&exchange=${encodeURIComponent(holding.exchange)}`
      : null,
  );

export const inr = (value: number, digits = 2): string =>
  `₹${value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const signed = (value: number, format: (v: number) => string): string =>
  `${value > 0 ? "+" : value < 0 ? "-" : ""}${format(Math.abs(value))}`;
