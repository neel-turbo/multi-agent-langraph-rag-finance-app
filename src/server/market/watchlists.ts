/**
 * Watchlists for both regions, with per-provider symbols.
 * src/server/market/watchlists.ts
 *
 * Every provider spells symbols differently (RELIANCE.NS vs RELIANCE:NSE vs
 * RELIANCE.BSE), so each entry carries a map. An entry with no symbol for the
 * active provider is simply skipped.
 */
import type { ProviderName } from "./providers/types.js";

export type Region = "india" | "world";

export interface WatchEntry {
  id: string; // stable display symbol, e.g. RELIANCE
  name: string;
  symbols: Partial<Record<ProviderName, string>>;
}

export const INDICES: Record<Region, WatchEntry[]> = {
  india: [
    { id: "NIFTY 50", name: "Nifty 50", symbols: { yahoo: "^NSEI" } },
    { id: "SENSEX", name: "BSE Sensex", symbols: { yahoo: "^BSESN" } },
    { id: "BANKNIFTY", name: "Nifty Bank", symbols: { yahoo: "^NSEBANK" } },
  ],
  world: [
    { id: "S&P 500", name: "S&P 500", symbols: { yahoo: "^GSPC" } },
    { id: "NASDAQ", name: "Nasdaq Composite", symbols: { yahoo: "^IXIC" } },
    { id: "FTSE 100", name: "FTSE 100", symbols: { yahoo: "^FTSE" } },
    { id: "NIKKEI", name: "Nikkei 225", symbols: { yahoo: "^N225" } },
  ],
};

export const WATCHLISTS: Record<Region, WatchEntry[]> = {
  india: [
    { id: "RELIANCE", name: "Reliance Industries", symbols: { yahoo: "RELIANCE.NS", "twelve-data": "RELIANCE:NSE", "alpha-vantage": "RELIANCE.BSE" } },
    { id: "TCS", name: "Tata Consultancy", symbols: { yahoo: "TCS.NS", "twelve-data": "TCS:NSE", "alpha-vantage": "TCS.BSE" } },
    { id: "HDFCBANK", name: "HDFC Bank", symbols: { yahoo: "HDFCBANK.NS", "twelve-data": "HDFCBANK:NSE", "alpha-vantage": "HDFCBANK.BSE" } },
    { id: "INFY", name: "Infosys", symbols: { yahoo: "INFY.NS", "twelve-data": "INFY:NSE", "alpha-vantage": "INFY.BSE" } },
    { id: "ICICIBANK", name: "ICICI Bank", symbols: { yahoo: "ICICIBANK.NS", "twelve-data": "ICICIBANK:NSE", "alpha-vantage": "ICICIBANK.BSE" } },
    { id: "SBIN", name: "State Bank of India", symbols: { yahoo: "SBIN.NS", "twelve-data": "SBIN:NSE", "alpha-vantage": "SBIN.BSE" } },
    { id: "BHARTIARTL", name: "Bharti Airtel", symbols: { yahoo: "BHARTIARTL.NS", "twelve-data": "BHARTIARTL:NSE", "alpha-vantage": "BHARTIARTL.BSE" } },
    { id: "ITC", name: "ITC", symbols: { yahoo: "ITC.NS", "twelve-data": "ITC:NSE", "alpha-vantage": "ITC.BSE" } },
    { id: "LT", name: "Larsen & Toubro", symbols: { yahoo: "LT.NS", "twelve-data": "LT:NSE", "alpha-vantage": "LT.BSE" } },
    { id: "HINDUNILVR", name: "Hindustan Unilever", symbols: { yahoo: "HINDUNILVR.NS", "twelve-data": "HINDUNILVR:NSE", "alpha-vantage": "HINDUNILVR.BSE" } },
    { id: "AXISBANK", name: "Axis Bank", symbols: { yahoo: "AXISBANK.NS", "twelve-data": "AXISBANK:NSE", "alpha-vantage": "AXISBANK.BSE" } },
    { id: "KOTAKBANK", name: "Kotak Mahindra Bank", symbols: { yahoo: "KOTAKBANK.NS", "twelve-data": "KOTAKBANK:NSE", "alpha-vantage": "KOTAKBANK.BSE" } },
    { id: "MARUTI", name: "Maruti Suzuki", symbols: { yahoo: "MARUTI.NS", "twelve-data": "MARUTI:NSE", "alpha-vantage": "MARUTI.BSE" } },
    { id: "TATAMOTORS", name: "Tata Motors", symbols: { yahoo: "TATAMOTORS.NS", "twelve-data": "TATAMOTORS:NSE", "alpha-vantage": "TATAMOTORS.BSE" } },
    { id: "SUNPHARMA", name: "Sun Pharmaceutical", symbols: { yahoo: "SUNPHARMA.NS", "twelve-data": "SUNPHARMA:NSE", "alpha-vantage": "SUNPHARMA.BSE" } },
  ],
  world: [
    { id: "AAPL", name: "Apple", symbols: { yahoo: "AAPL", "twelve-data": "AAPL", "alpha-vantage": "AAPL" } },
    { id: "MSFT", name: "Microsoft", symbols: { yahoo: "MSFT", "twelve-data": "MSFT", "alpha-vantage": "MSFT" } },
    { id: "NVDA", name: "NVIDIA", symbols: { yahoo: "NVDA", "twelve-data": "NVDA", "alpha-vantage": "NVDA" } },
    { id: "GOOGL", name: "Alphabet", symbols: { yahoo: "GOOGL", "twelve-data": "GOOGL", "alpha-vantage": "GOOGL" } },
    { id: "AMZN", name: "Amazon", symbols: { yahoo: "AMZN", "twelve-data": "AMZN", "alpha-vantage": "AMZN" } },
    { id: "META", name: "Meta Platforms", symbols: { yahoo: "META", "twelve-data": "META", "alpha-vantage": "META" } },
    { id: "TSLA", name: "Tesla", symbols: { yahoo: "TSLA", "twelve-data": "TSLA", "alpha-vantage": "TSLA" } },
    { id: "JPM", name: "JPMorgan Chase", symbols: { yahoo: "JPM", "twelve-data": "JPM", "alpha-vantage": "JPM" } },
    { id: "TSM", name: "TSMC", symbols: { yahoo: "TSM", "twelve-data": "TSM", "alpha-vantage": "TSM" } },
    { id: "ASML", name: "ASML", symbols: { yahoo: "ASML", "twelve-data": "ASML", "alpha-vantage": "ASML" } },
    { id: "NESN", name: "Nestlé", symbols: { yahoo: "NESN.SW" } },
    { id: "7203", name: "Toyota", symbols: { yahoo: "7203.T" } },
    { id: "SHEL", name: "Shell", symbols: { yahoo: "SHEL.L" } },
    { id: "BABA", name: "Alibaba", symbols: { yahoo: "BABA", "twelve-data": "BABA" } },
    { id: "005930", name: "Samsung Electronics", symbols: { yahoo: "005930.KS" } },
  ],
};

export const REGIONS: Region[] = ["india", "world"];
