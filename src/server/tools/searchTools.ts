/**
 * Tavily web search, split by topic so each agent gets the right flavour.
 * src/server/tools/searchTools.ts
 *
 * Each tool gets its own name (Tavily defaults all of them to "tavily_search"),
 * so agent prompts can refer to them unambiguously.
 */
import { TavilySearch } from "@langchain/tavily";

export const marketSearch = new TavilySearch({
  name: "market_search",
  description:
    "Live finance web search: market commentary, sector trends, rates, earnings, macro data. " +
    "Input should be a specific search query.",
  maxResults: 5,
  topic: "finance",
});

export const newsSearch = new TavilySearch({
  name: "news_search",
  description:
    "Live news search limited to the past week: financial and economic news. " +
    "Input should be a specific search query.",
  maxResults: 5,
  topic: "news",
  // Recent news only; widen if the news agent comes back empty.
  timeRange: "week",
});

/** General web search: rag_search falls back to this when the knowledge base has nothing relevant. */
export const webSearch = new TavilySearch({
  name: "web_search",
  maxResults: 5,
  topic: "general",
});
