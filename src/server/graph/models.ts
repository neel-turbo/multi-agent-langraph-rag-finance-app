/**
 * Model registry: every LLM in the app is chosen here, per role, by env vars.
 * src/server/graph/models.ts
 *
 * Roles differ in what they need:
 *   planner / reviewer  -> reliable structured output (JSON that matches a schema)
 *   agent               -> solid tool calling, runs most often (cheapest per call matters)
 *   synthesizer         -> best prose, streams to the user
 *
 * Providers: google-genai (Gemini), anthropic (Claude), openai, ollama (local).
 *
 *   LLM_PROVIDER=anthropic            every role on Claude
 *   LLM_FALLBACK_PROVIDER=google-genai  used when the primary errors; "none" to disable
 *   AGENT_PROVIDER=ollama             per-role override (PLANNER_, REVIEWER_, AGENT_, SYNTHESIZER_)
 *   AGENT_MODEL=llama3.1:8b           per-role model; otherwise the provider's *_MODEL below
 *
 * Every role is heavy work (multi-step reasoning, strict JSON, tool loops over the user's
 * holdings, long prose), so all of them run on the primary provider; small talk never
 * reaches a model (plan() answers it with a regex).
 *
 * npm i @langchain/google-genai @langchain/anthropic @langchain/openai @langchain/ollama
 */
import { initChatModel } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { z } from "zod";

export type Role = "planner" | "reviewer" | "agent" | "synthesizer";

const PROVIDERS = ["google-genai", "anthropic", "openai", "ollama"] as const;
type Provider = (typeof PROVIDERS)[number];

interface ModelChoice {
  provider: Provider;
  model: string;
}

interface RoleConfig extends ModelChoice {
  /** Used when the primary provider errors (quota, rate limit, outage, offline Ollama). */
  fallback: ModelChoice | null;
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/** Each provider's model when a role doesn't name one. */
const DEFAULT_MODEL: Record<Provider, string> = {
  "google-genai": process.env.GOOGLE_MODEL ?? "gemini-2.5-flash",
  anthropic: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  openai: process.env.OPENAI_MODEL ?? "gpt-5",
  ollama: process.env.OLLAMA_MODEL ?? "qwen3.5:4b",
};

/** The env var each hosted provider's SDK reads its key from. Ollama needs none. */
const API_KEY_ENV: Partial<Record<Provider, string>> = {
  "google-genai": "GOOGLE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function parseProvider(value: string | undefined, variable: string): Provider | undefined {
  if (!value) return undefined;
  if ((PROVIDERS as readonly string[]).includes(value)) return value as Provider;
  throw new Error(`${variable}=${value} is not a provider. Use one of: ${PROVIDERS.join(", ")}.`);
}

const DEFAULT_PROVIDER = parseProvider(process.env.LLM_PROVIDER, "LLM_PROVIDER") ?? "google-genai";
const DEFAULT_FALLBACK =
  process.env.LLM_FALLBACK_PROVIDER === "none"
    ? null
    : (parseProvider(process.env.LLM_FALLBACK_PROVIDER, "LLM_FALLBACK_PROVIDER") ?? "ollama");

function envConfig(role: Role): RoleConfig {
  const prefix = role.toUpperCase();
  const provider = parseProvider(process.env[`${prefix}_PROVIDER`], `${prefix}_PROVIDER`) ?? DEFAULT_PROVIDER;
  // The model follows the provider: switching AGENT_PROVIDER alone must not send a Gemini
  // model name to Ollama.
  const model = process.env[`${prefix}_MODEL`] ?? DEFAULT_MODEL[provider];

  const fallbackVar = process.env[`${prefix}_FALLBACK_PROVIDER`];
  const fallbackProvider =
    fallbackVar === "none" ? null : (parseProvider(fallbackVar, `${prefix}_FALLBACK_PROVIDER`) ?? DEFAULT_FALLBACK);
  // Falling back to the exact same model can't help; skip it.
  const fallback =
    fallbackProvider && !(fallbackProvider === provider && DEFAULT_MODEL[fallbackProvider] === model)
      ? { provider: fallbackProvider, model: DEFAULT_MODEL[fallbackProvider] }
      : null;

  return { provider, model, fallback };
}

const CONFIG: Record<Role, RoleConfig> = {
  planner: envConfig("planner"), // plan + review + final answer (see supervisorGraph.ts)
  reviewer: envConfig("reviewer"),
  agent: envConfig("agent"), // specialist tool-calling loops
  synthesizer: envConfig("synthesizer"),
};

/** Fail at startup, naming the missing key, instead of on the first question. */
function requireKey({ provider }: ModelChoice, usage: string): void {
  const variable = API_KEY_ENV[provider];
  if (variable && !process.env[variable]) {
    throw new Error(`${usage} uses ${provider}, but ${variable} is not set in .env.`);
  }
}

/** Provider-specific constructor options. */
function modelOptions(provider: Provider): Record<string, unknown> {
  switch (provider) {
    case "ollama":
      return { temperature: 0, baseUrl: OLLAMA_BASE_URL };
    case "google-genai":
      return { temperature: 0 };
    case "anthropic":
      // Current Claude models reject sampling params (temperature/top_p/top_k), and thinking
      // is adaptive by default. Room for long answers; LangChain's default cap is lower.
      return { maxTokens: 16_000 };
    case "openai":
      // GPT-5-family reasoning models reject a custom temperature.
      return {};
  }
}

async function create({ provider, model }: ModelChoice): Promise<BaseChatModel> {
  // Note: pass the model name separately — an Ollama tag like "qwen3.5:4b"
  // contains a colon and can't go in the "provider:model" shorthand.
  return (await initChatModel(model, { modelProvider: provider, ...modelOptions(provider) })) as unknown as BaseChatModel;
}

// Built once at startup so nodes can stay synchronous.
const primary = {} as Record<Role, BaseChatModel>;
const secondary = {} as Record<Role, BaseChatModel | null>;

for (const role of Object.keys(CONFIG) as Role[]) {
  const config = CONFIG[role];
  requireKey(config, role);
  primary[role] = await create(config);

  // A fallback with a missing key is skipped with a warning, not fatal.
  let fallback = config.fallback;
  if (fallback) {
    try {
      requireKey(fallback, `${role} fallback`);
    } catch (error) {
      console.warn(`[models] ${(error as Error).message} Continuing without a fallback.`);
      fallback = null;
    }
  }
  secondary[role] = fallback ? await create(fallback) : null;
  CONFIG[role].fallback = fallback;

  const backup = fallback ? ` (fallback ${fallback.provider}/${fallback.model})` : " (no fallback)";
  console.log(`[models] ${role}: ${config.provider}/${config.model}${backup}`);
}

/** The model for a role. Use for plain calls and for createAgent (keeps bindTools). */
export function getModel(role: Role): BaseChatModel {
  return primary[role];
}

/** The role's fallback model, or null. For createAgent, which needs a bare model to bind tools. */
export function getFallbackModel(role: Role): BaseChatModel | null {
  return secondary[role];
}

/**
 * Structured output for one model. Claude uses native JSON-schema output
 * (output_config.format): LangChain's default for Anthropic forces a tool call, which the
 * API rejects while thinking is on — and it's on by default on current Claude models.
 */
function structured<T extends Record<string, unknown>>(
  model: BaseChatModel,
  provider: Provider,
  schema: z.ZodType<T>,
  name: string,
): Runnable<BaseLanguageModelInput, T> {
  return provider === "anthropic"
    ? model.withStructuredOutput<T>(schema, { name, method: "jsonSchema" })
    : model.withStructuredOutput<T>(schema, { name });
}

/**
 * Structured output with a cross-provider fallback.
 * The fallback is applied AFTER withStructuredOutput, because a
 * RunnableWithFallbacks has no withStructuredOutput / bindTools of its own.
 */
export function structuredWithFallback<T extends Record<string, unknown>>(
  role: Role,
  schema: z.ZodType<T>,
  name: string,
): Runnable<BaseLanguageModelInput, T> {
  const { provider, fallback } = CONFIG[role];
  const main = structured(primary[role], provider, schema, name);
  const backupModel = secondary[role];
  const backup = backupModel && fallback ? structured(backupModel, fallback.provider, schema, name) : null;
  return backup ? main.withFallbacks([backup]) : main;
}

/** Plain chat with a cross-provider fallback (used by the synthesizer). */
export function chatWithFallback(
  role: Role,
): Runnable<BaseLanguageModelInput, unknown> {
  const main = primary[role];
  const backup = secondary[role];
  return backup ? main.withFallbacks([backup]) : main;
}
