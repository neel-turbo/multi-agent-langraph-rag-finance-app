/**
 * Twelve Data provider — official API, 800 requests/day free, 8/minute.
 * Covers Indian exchanges (NSE/BSE) and world markets.
 * src/server/market/providers/twelveData.ts
 *
 * Batching note: /quote accepts comma-separated symbols in ONE http call, but
 * each symbol still costs one credit against the daily allowance.
 */
import type { MarketProvider, Quote } from "./types.js";

const API_KEY = process.env.TWELVE_DATA_API_KEY ?? "";
const BASE_URL = "https://api.twelvedata.com";
const DAILY_LIMIT = Number(process.env.TWELVE_DATA_DAILY_LIMIT ?? 800);

let creditsUsed = 0;
let creditDate = new Date().toISOString().slice(0, 10);

function spend(credits: number): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== creditDate) {
    creditDate = today;
    creditsUsed = 0;
  }
  creditsUsed += credits;
}

interface TwelveQuoteRow {
  symbol?: string;
  name?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  currency?: string;
  datetime?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
}

function toQuote(row: TwelveQuoteRow): Quote | null {
  if (!row?.close || row.status === "error") return null;
  const price = Number(row.close);
  const previousClose = Number(row.previous_close ?? row.close);
  return {
    symbol: row.symbol ?? "",
    name: row.name ?? row.symbol ?? "",
    price,
    previousClose,
    changePct: Number(row.percent_change ?? 0),
    currency: row.currency ?? "USD",
    asOf: (row.datetime ?? new Date().toISOString()).slice(0, 10),
    live: Boolean(row.is_market_open),
  };
}

export const twelveDataProvider: MarketProvider = {
  name: "twelve-data",

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    if (!symbols.length) return [];
    if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is not set");
    if (creditsUsed + symbols.length > DAILY_LIMIT) throw new Error("Twelve Data daily credits exhausted");

    const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${API_KEY}`;
    const response = await fetch(url);
    const payload = (await response.json()) as Record<string, TwelveQuoteRow> | TwelveQuoteRow;
    spend(symbols.length);

    // A rejected request (rate limit, bad key, plan) is one top-level error object, not
    // a map of symbols — surface its message instead of parsing "code"/"message" as tickers.
    const top = payload as TwelveQuoteRow;
    if (top.status === "error" && typeof top.message === "string") {
      throw new Error(`Twelve Data ${top.code ?? response.status}: ${top.message}`);
    }

    // One symbol returns the object directly; several return a map keyed by symbol.
    const rows =
      symbols.length === 1
        ? [{ ...(payload as TwelveQuoteRow), symbol: symbols[0] }]
        : Object.entries(payload as Record<string, TwelveQuoteRow>).map(([symbol, row]) => ({
            ...row,
            symbol,
          }));

    return rows.map(toQuote).filter((quote): quote is Quote => quote !== null);
  },

  async getSeries(symbol: string, points = 30): Promise<number[]> {
    if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is not set");
    const url =
      `${BASE_URL}/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=1day&outputsize=${points}&apikey=${API_KEY}`;

    const response = await fetch(url);
    const payload = (await response.json()) as { values?: { close: string }[]; message?: string };
    spend(1);

    if (!payload.values) throw new Error(`Twelve Data: ${payload.message ?? `no series for ${symbol}`}`);
    return payload.values.map((bar) => Number(bar.close)).reverse(); // API returns newest first
  },

  budget() {
    return { used: creditsUsed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - creditsUsed) };
  },
};
