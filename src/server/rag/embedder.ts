/**
 * Local text embeddings in TypeScript (no Python at runtime).
 * Model: bge-small-en-v1.5 (~130 MB, cached after first download).
 */
import { pipeline } from "@huggingface/transformers";

const MODEL = process.env.EMBED_MODEL ?? "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/** Minimal shape we rely on, so we don't depend on the library's internal types. */
type Extractor = (
  texts: string[],
  options: { pooling: "cls"; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

let _extractor: Extractor | null = null;

async function getExtractor(): Promise<Extractor> {
  _extractor ??= (await pipeline("feature-extraction", MODEL, {
    dtype: "fp32",
  })) as unknown as Extractor;
  return _extractor;
}

async function encode(texts: string[]): Promise<number[][]> {
  const extract = await getExtractor();
  const output = await extract(texts, { pooling: "cls", normalize: true });
  return output.tolist();
}

/** Embed document chunks for storage. */
export async function embedPassages(texts: string[], batchSize = 16): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    vectors.push(...(await encode(texts.slice(i, i + batchSize))));
  }
  return vectors;
}

/** Embed a user question for search. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await encode([QUERY_PREFIX + text]);
  return vector;
}

/** Adapter matching Chroma's IEmbeddingFunction. */
export const embeddingFunction = {
  generate: (texts: string[]): Promise<number[][]> => embedPassages(texts),
};
