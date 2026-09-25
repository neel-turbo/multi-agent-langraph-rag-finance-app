/**
 * rag_search over the LiteParse + ChromaDB index.
 * src/server/tools/ragTool.ts
 */
import { tool } from "@langchain/core/tools";
import { ChromaClient, type Collection, type Where } from "chromadb";
import { z } from "zod";

import type { Citation } from "../../shared/types.js";
import { embedQuery } from "../rag/embedder.js";
import { webSearch } from "./searchTools.js";

/**
 * Passages scoring below this (cosine similarity, 0-1) count as "not relevant".
 * Measured with bge-small on this index: on-topic tax queries score 0.71-0.88,
 * off-topic ones 0.52-0.63. Retune if you change EMBED_MODEL.
 */
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.68);

interface WebResult {
  title?: string;
  url: string;
  content?: string;
  score?: number;
}

/** Tavily fallback for when the knowledge base can't answer. Never throws. */
async function searchWeb(query: string, reason: string): Promise<[string, Citation[]]> {
  try {
    const response = (await webSearch.invoke({ query })) as { results?: WebResult[]; error?: string };
    const results = response.results ?? [];
    if (!results.length) {
      return [`${reason} Web search also found nothing${response.error ? ` (${response.error})` : ""}.`, []];
    }
    const content = results
      .map((r) => `[Web: ${r.title ?? r.url} — ${r.url}]\n${r.content ?? ""}`)
      .join("\n\n---\n\n");
    const citations: Citation[] = results.map((r) => ({
      source: r.title ?? r.url,
      page: null,
      section: null,
      similarity: Number((r.score ?? 0).toFixed(3)),
      url: r.url,
    }));
    return [`${reason} Showing web search results instead — cite the URLs.\n\n${content}`, citations];
  } catch (error) {
    return [`${reason} Web search failed too (${(error as Error).message}).`, []];
  }
}

const client = new ChromaClient({ path: process.env.CHROMA_URL ?? "http://localhost:8000" });

let cached: Collection | null = null;
async function getCollection(): Promise<Collection> {
  cached ??= await client.getCollection({ name: "finance_docs" });
  return cached;
}

/** Matches what ingest.ts writes. */
export interface ChunkMetadata {
  docId: string;
  source: string;
  chunkIndex: number;
  elementType: "text" | "table" | "image";
  domain: string;
  charCount: number;
  ingestedAt: string;
  page?: number;
  section?: string;
  jurisdiction?: string;
  taxYear?: string;
}

function buildWhere(fields: Record<string, string | undefined>): Where | undefined {
  const conditions: Where[] = Object.entries(fields)
    .filter((entry): entry is [string, string] => !!entry[1] && entry[1] !== "general")
    .map(([field, value]) => ({ [field]: value }));
  if (!conditions.length) return undefined;
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

const ragSchema = z.object({
  query: z.string().describe("What to look for, phrased as a question or topic."),
  domain: z.enum(["general", "tax", "investing"]).describe("Narrows the search."),
  jurisdiction: z.string().optional().describe("e.g. IN, US. Use for tax questions."),
  taxYear: z.string().optional().describe("e.g. 2025. Use when the year matters."),
  tablesOnly: z
    .boolean()
    .optional()
    .describe("True when the answer is a rate, slab or figure that lives in a table."),
});

export const ragSearch = tool(
  async ({
    query,
    domain,
    jurisdiction,
    taxYear,
    tablesOnly,
  }: z.infer<typeof ragSchema>): Promise<[string, Citation[]]> => {
    try {
      const collection = await getCollection();
      const results = await collection.query({
        queryEmbeddings: [await embedQuery(query)],
        nResults: 6,
        where: buildWhere({
          domain,
          jurisdiction,
          taxYear,
          elementType: tablesOnly ? "table" : undefined,
        }),
      });

      const documents = results.documents[0] ?? [];
      const metadatas = (results.metadatas[0] ?? []) as (ChunkMetadata | null)[];
      const distances = results.distances?.[0] ?? [];

      // Keep only passages that are actually about the query; distance is cosine (1 - similarity).
      const hits = documents
        .map((text, i) => ({ text, meta: metadatas[i], similarity: 1 - (distances[i] ?? 1) }))
        .filter((hit): hit is { text: string; meta: ChunkMetadata | null; similarity: number } =>
          hit.text !== null && hit.similarity >= MIN_SIMILARITY
        );
      if (!hits.length) return searchWeb(query, "No relevant passages found in the knowledge base.");

      const content = hits
        .map(({ text, meta }) => {
          if (!meta) return text;
          const where = meta.page ? `${meta.source}, page ${meta.page}` : meta.source;
          return `[${where}${meta.section ? ` — ${meta.section}` : ""}]\n${text}`;
        })
        .join("\n\n---\n\n");

      const citations: Citation[] = hits
        .filter((hit) => hit.meta)
        .map(({ meta, similarity }) => ({
          source: meta!.source,
          page: meta!.page ?? null,
          section: meta!.section ?? null,
          similarity: Number(similarity.toFixed(3)),
        }));

      return [content, citations];
    } catch (error) {
      // Return, don't throw: the web fallback keeps the agent going when Chroma is down.
      return searchWeb(query, `Knowledge base unavailable (${(error as Error).message}).`);
    }
  },
  {
    name: "rag_search",
    description:
      "Search the financial knowledge base built from the ingested PDFs. " +
      "If nothing relevant is found there, it automatically falls back to a web search. " +
      "Returns passages with their source and page (or URL for web results). Always cite them.",
    schema: ragSchema,
    responseFormat: "content_and_artifact",
  }
);
