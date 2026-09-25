import { Client } from "@langchain/langgraph-sdk";

export const LANGGRAPH_URL =
  (import.meta.env.VITE_LANGGRAPH_URL as string | undefined) ??
  "http://localhost:2024";

/** One SDK client for the app: the chat stream and the conversation list share it. */
export const langgraph = new Client({ apiUrl: LANGGRAPH_URL });
