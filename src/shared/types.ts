/**
 * Types shared between the browser (src/components) and the server (src/server).
 * TYPES ONLY — this file must never contain runtime code, because anything
 * importable by the browser gets bundled into it.
 */
export const AGENT_NAMES = [
  "finance_qa",
  "portfolio",
  "market",
  "goal_planning",
  "news",
  "tax",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export const AGENT_LABELS: Record<AgentName, string> = {
  finance_qa: "Finance Q&A",
  portfolio: "Portfolio analysis",
  market: "Market analysis",
  goal_planning: "Goal planning",
  news: "News synthesizer",
  tax: "Tax education",
};

export interface Task {
  agent: AgentName;
  query: string;
  dependsOn: AgentName[];
}

export interface AgentOutput {
  agent: AgentName;
  query: string;
  answer: string;
  round: number;
}

export interface Citation {
  source: string;
  page: number | null;
  section: string | null;
  similarity: number;
  /** Set when the passage came from the web fallback, not the knowledge base. */
  url?: string;
}

/** One equity holding, normalised from Kite's /portfolio/holdings. Money is in INR. */
export interface Holding {
  symbol: string; // Kite tradingsymbol, e.g. SBIN
  exchange: string; // NSE | BSE
  isin: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  closePrice: number; // previous session close
  invested: number; // quantity × averagePrice
  currentValue: number; // quantity × lastPrice
  pnl: number;
  pnlPct: number;
  dayChange: number; // whole position, not per share
  dayChangePct: number;
  weightPct: number; // share of the portfolio's current value
}

export interface PortfolioTotals {
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
}

export interface PortfolioSnapshot {
  source: string; // where the holdings came from, e.g. "Zerodha Kite demo"
  accountId: string | null;
  fetchedAt: string; // ISO timestamp
  holdings: Holding[]; // largest current value first
  totals: PortfolioTotals;
}

export interface PricePoint {
  date: string; // ISO date
  close: number;
}

export interface PriceHistory {
  symbol: string; // provider symbol, e.g. SBIN.NS
  points: PricePoint[]; // oldest first
}

export interface UserProfile {
  risk?: string;
  horizonYears?: number;
  jurisdiction?: string;
  holdings?: Record<string, number>;
  [key: string]: unknown;
}
