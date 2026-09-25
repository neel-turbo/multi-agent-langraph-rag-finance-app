/**
 * Ingest PDFs into ChromaDB using LiteParse (local, Rust, no models).
 *
 *   npm run ingest -- pdfs/tax_guide_2025.pdf --domain tax --jurisdiction IN --tax-year 2025
 *   npm run ingest -- pdfs --domain investing
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { LiteParse } from "@llamaindex/liteparse";
import { ChromaClient, type Collection } from "chromadb";

import { chunkMarkdown, type Chunk } from "./chunk.js";
import { embedPassages, embeddingFunction } from "./embedder.js";

const CHROMA_URL = process.env.CHROMA_URL ?? "http://localhost:8000";
const COLLECTION = "finance_docs";
const client = new ChromaClient({ path: CHROMA_URL });

export interface IngestFlags {
  target: string;
  domain: "general" | "tax" | "investing";
  jurisdiction: string | null;
  taxYear: string | null;
  ocr: boolean;
}

/** Chroma metadata accepts only these value types — no nulls, arrays or objects. */
type ChromaMetadata = Record<string, string | number | boolean>;

interface DocRef {
  docId: string;
  source: string;
}

/**
 * LiteParse returns the whole document's Markdown on result.text with no page
 * markers, so we parse a page at a time (cheap — it's Rust) and re-insert the
 * `{n}------` separators chunk.ts understands. That keeps page numbers for citations.
 */
async function pdfToPagedMarkdown(
  pdfPath: string,
  { ocr }: Pick<IngestFlags, "ocr">
): Promise<{ markdown: string; pageCount: number }> {
  const probe = new LiteParse({ outputFormat: "text", ocrEnabled: false });
  const { pages } = await probe.parse(pdfPath);

  const parts: string[] = [];
  for (let p = 1; p <= pages.length; p++) {
    const parser = new LiteParse({
      outputFormat: "markdown",
      imageMode: "placeholder", // keeps ![](image_pN_K.png) refs; "off" strips them
      extractLinks: true,
      ocrEnabled: ocr, // only for scanned PDFs
      targetPages: String(p),
    });
    const result = await parser.parse(pdfPath);
    parts.push(`{${p - 1}}${"-".repeat(48)}`, result.text.trim());
  }
  return { markdown: parts.join("\n\n"), pageCount: pages.length };
}

function buildMetadata(
  chunk: Chunk,
  index: number,
  doc: DocRef,
  flags: IngestFlags
): ChromaMetadata {
  const meta: ChromaMetadata = {
    docId: doc.docId,
    source: doc.source,
    chunkIndex: index,
    elementType: chunk.elementType, // text | table | image
    domain: flags.domain,
    charCount: chunk.text.length,
    ingestedAt: new Date().toISOString().slice(0, 10),
  };
  if (chunk.page != null) meta.page = chunk.page;
  if (chunk.section) meta.section = chunk.section.slice(0, 120);
  if (flags.jurisdiction) meta.jurisdiction = flags.jurisdiction;
  if (flags.taxYear) meta.taxYear = flags.taxYear;
  return meta;
}

async function ingestPdf(
  pdfPath: string,
  collection: Collection,
  flags: IngestFlags
): Promise<void> {
  const source = path.basename(pdfPath);
  const docId = createHash("sha1").update(await readFile(pdfPath)).digest("hex").slice(0, 12);

  const { markdown, pageCount } = await pdfToPagedMarkdown(pdfPath, flags);
  const chunks = chunkMarkdown(markdown);
  if (!chunks.length) {
    console.log(`skip  ${source} (no extractable text — try --ocr)`);
    return;
  }

  await collection.delete({ where: { docId } }); // re-ingest replaces, never duplicates

  const embeddings = await embedPassages(chunks.map((c) => c.text));
  const BATCH = 100;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    await collection.upsert({
      ids: slice.map((_, j) => `${docId}_c${i + j}`),
      embeddings: embeddings.slice(i, i + BATCH),
      documents: slice.map((c) => c.text),
      metadatas: slice.map((c, j) => buildMetadata(c, i + j, { docId, source }, flags)),
    });
  }

  const tables = chunks.filter((c) => c.elementType === "table").length;
  console.log(`done  ${source}: ${pageCount} pages -> ${chunks.length} chunks (${tables} tables)`);
}

async function collectPdfs(target: string): Promise<string[]> {
  if ((await stat(target)).isFile()) return [target];
  const found: string[] = [];
  for (const entry of await readdir(target)) {
    const full = path.join(target, entry);
    if ((await stat(full)).isDirectory()) found.push(...(await collectPdfs(full)));
    else if (entry.toLowerCase().endsWith(".pdf")) found.push(full);
  }
  return found;
}

function parseArgs(argv: string[]): IngestFlags {
  const [target, ...rest] = argv;
  if (!target) throw new Error("Usage: npm run ingest -- <pdf-or-folder> [--domain tax] [--ocr]");

  const flags: IngestFlags = {
    target,
    domain: "general",
    jurisdiction: null,
    taxYear: null,
    ocr: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "");
    if (key === "ocr") flags.ocr = true;
    else if (key === "domain") flags.domain = rest[++i] as IngestFlags["domain"];
    else if (key === "jurisdiction") flags.jurisdiction = rest[++i];
    else if (key === "tax-year") flags.taxYear = rest[++i];
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const collection = await client.getOrCreateCollection({
    name: COLLECTION,
    metadata: { "hnsw:space": "cosine" },
    embeddingFunction,
  });

  const pdfs = await collectPdfs(flags.target);
  console.log(`Found ${pdfs.length} PDF(s)`);
  for (const pdf of pdfs) await ingestPdf(pdf, collection, flags);
  console.log(`Collection now holds ${await collection.count()} chunks.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
