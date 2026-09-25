/**
 * Chunker for LiteParse's Markdown output.
 *  - page numbers come from the `{n}------` separators ingest.ts inserts
 *  - headings become chunk context and metadata
 *  - tables are never split
 */
export type ElementType = "text" | "table" | "image";

export interface Chunk {
  text: string;
  page: number | null;
  section: string;
  elementType: ElementType;
}

const PAGE_SEPARATOR = /^\{(\d+)\}-{5,}\s*$/;
const MAX_CHARS = 1800; // ~450 tokens, inside bge's 512 limit
const MIN_CHARS = 120;

interface Page {
  page: number | null;
  text: string;
}

function splitPages(markdown: string): Page[] {
  const pages: { page: number | null; lines: string[] }[] = [];
  let current: { page: number | null; lines: string[] } = { page: null, lines: [] };

  for (const line of markdown.split("\n")) {
    const match = line.match(PAGE_SEPARATOR);
    if (match) {
      if (current.lines.length) pages.push(current);
      current = { page: Number(match[1]) + 1, lines: [] }; // separators are 0-indexed
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) pages.push(current);

  return pages.map((p) => ({ page: p.page, text: p.lines.join("\n").trim() }));
}

function classify(block: string): ElementType | "heading" {
  if (/^#{1,6}\s/.test(block)) return "heading";
  const lines = block.split("\n");
  if (lines.length >= 2 && lines.filter((l) => l.trim().startsWith("|")).length >= 2) return "table";
  if (/^!\[/.test(block)) return "image";
  return "text";
}

function splitLongText(text: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (buffer.length + sentence.length > MAX_CHARS && buffer) {
      parts.push(buffer.trim());
      buffer = "";
    }
    buffer += sentence + " ";
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const { page, text } of splitPages(markdown)) {
    let section = "";
    let buffer: string[] = [];
    let types = new Set<ElementType>();

    const flush = (): void => {
      const body = buffer.join("\n\n").trim();
      buffer = [];
      const elementType: ElementType = types.has("table")
        ? "table"
        : types.has("image")
          ? "image"
          : "text";
      types = new Set();
      if (!body) return;
      if (body.length < MIN_CHARS && elementType === "text") return;
      chunks.push({ text: section ? `## ${section}\n\n${body}` : body, page, section, elementType });
    };

    const blocks = text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);

    for (const block of blocks) {
      const type = classify(block);

      if (type === "heading") {
        flush();
        section = block.replace(/^#+\s*/, "").trim();
        continue;
      }

      if (type === "table") {
        flush(); // a table starts a fresh chunk and stays intact
        types.add("table");
        buffer.push(block);
        flush();
        continue;
      }

      for (const piece of block.length > MAX_CHARS ? splitLongText(block) : [block]) {
        if (buffer.join("\n\n").length + piece.length > MAX_CHARS) flush();
        types.add(type);
        buffer.push(piece);
      }
    }
    flush();
  }

  return chunks;
}
