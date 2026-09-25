/**
 * Supervisor with multi-agent reasoning (TypeScript).
 *
 *   plan ──Send──▶ agents (parallel) ──▶ review ──┬──Send──▶ agents ──▶ review ...
 *     │                                          └──────▶ synthesize ──▶ END
 *     └── small talk ──▶ END
 *
 * plan, review and synthesize all run on the planner model: the planner decides whether
 * any specialist is needed at all, assigns only the ones whose tools can answer, checks
 * their findings, and writes the summarized answer. Each specialist is a ReAct agent
 * (reason → call a tool → observe → repeat) whose prompt lists exactly the tools it holds.
 *
 * src/server/graph/supervisorGraph.ts
 */
import { z } from "zod";
import { createAgent } from "langchain";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  MessagesAnnotation,
  START,
  Send,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";

import { chatWithFallback, getFallbackModel, getModel, structuredWithFallback } from "./models.js";
import {
  AGENT_NAMES,
  type AgentName,
  type AgentOutput,
  type Holding,
  type Task,
  type UserProfile,
} from "../../shared/types.js";
import { ragSearch } from "../tools/ragTool.js";
import { cagr, sipFutureValue } from "../tools/calcTools.js";
import { marketMovers, stockQuote } from "../tools/marketTools.js";
import { marketSearch, newsSearch } from "../tools/searchTools.js";
import { getPortfolio } from "../portfolio/kite.js";

// ─────────────────────────── config ───────────────────────────
const MAX_ROUNDS = 3;
const NOSTREAM = "langsmith:nostream"; // keeps internal LLM calls out of the UI token stream

export const AGENTS = AGENT_NAMES;


/** What each specialist can call. The prompts below name exactly these tools. */
const AGENT_TOOLS: Record<AgentName, unknown[]> = {
  finance_qa: [ragSearch],
  portfolio: [stockQuote, ragSearch, sipFutureValue, cagr],
  market: [marketMovers, stockQuote, marketSearch],
  goal_planning: [sipFutureValue, cagr, ragSearch],
  news: [newsSearch, marketSearch],
  tax: [ragSearch],
};

/** Role + tools + when to use each tool. SHARED_RULES adds the ReAct loop and answer format. */
const AGENT_PROMPTS: Record<AgentName, string> = {
  finance_qa: `You are the Finance Q&A specialist. You explain financial concepts clearly for a learner.

Tools:
- rag_search: the financial knowledge base (ingested PDFs). Falls back to the web automatically
  when nothing relevant is found. Use it for every definition, rule or concept.

Search for the concept first, then explain it in plain language with a short worked example.`,

  portfolio: `You are the Portfolio specialist. You analyse the user's holdings: allocation, concentration,
risk and costs.

The user's actual holdings from their Zerodha Kite account arrive with the task as JSON
("Holdings JSON"): totals for the whole portfolio, then columns + rows, one row per holding,
largest current value first. Money is INR; weightPct is the share of portfolio value.
These numbers are already computed: quote them directly, and base every statement about
"my portfolio" on them. Never invent a holding that isn't in the JSON.

Tools:
- stock_quote: current price and recent range of one stock or index (RELIANCE.NS, TCS.NS, AAPL...).
  Use it to value holdings at today's prices.
- rag_search: knowledge base (web fallback) for rules of thumb, fund categories, costs, definitions.
- sip_future_value: future value of a monthly SIP. Use for any "what will this grow to" question.
- cagr: compound annual growth rate between two values. Use for historical or required returns.

Any number not in the Holdings JSON comes from a tool call — never do arithmetic in your head.`,

  market: `You are the Market specialist. You give current market context for Indian and world markets.

Tools:
- market_movers: index levels plus top gainers/losers. region: india | world | both.
  Start here for "how is the market today".
- stock_quote: price and recent range of one stock or index (RELIANCE.NS, ^NSEI, AAPL, ^GSPC...).
- market_search: live finance web search for the WHY — sector moves, rates, earnings, macro.

Only state figures a tool returned. Give the date for every figure and say whether it is live
or a previous close. Say that movers are ranked within a watchlist, not the whole market.`,

  goal_planning: `You are the Goal Planning specialist. You turn goals into numbers: target corpus, horizon,
required monthly saving.

Tools:
- sip_future_value: future value of a monthly SIP. Try several monthly amounts to find the one
  that reaches the target.
- cagr: the growth rate needed to go from today's amount to the target over the horizon.
- rag_search: knowledge base (web fallback) for reasonable return/inflation assumptions and instruments.

Every number comes from a calculator call. State the return and inflation assumptions you used.`,

  news: `You are the News specialist. You summarise recent financial news and explain why it matters.

Tools:
- news_search: news from the past week. Start here.
- market_search: finance web search. Use it when news_search is thin, or to explain the market
  impact of a story.

Include the date and source of every story. If the week is quiet, search again with broader terms.`,

  tax: `You are the Tax specialist. You explain tax rules, slabs, deductions and account types.

Tools:
- rag_search: tax knowledge base (ingested tax documents). Falls back to the web automatically.
  Always pass jurisdiction (e.g. IN) and taxYear when known. For rates and slabs, if the first
  search misses the table, search again with tablesOnly=true.

Always state the jurisdiction and tax year in your answer. Education, not advice.`,
};

/** ReAct loop shared by every specialist: reason → act (tool) → observe → repeat → answer. */
const SHARED_RULES = `

Work in a ReAct loop until the task is answered:
1. Thought: what do I still need to know to answer the task?
2. Action: call the single most useful tool for that (only tools listed above).
3. Observation: read the result. Is it relevant, dated, and enough?
4. Repeat. If a result is empty or off-topic, rephrase the query (more specific terms,
   official names, section numbers) or try your other tool — don't give up after one call.
Stop when every part of the task is backed by a tool result, or after about 5 tool calls.

Never answer from memory when a tool can verify it. Then reply with concise findings:
- Cite every fact: [document, page] for knowledge-base passages, the URL for web results.
- Say which facts came from the web rather than the knowledge base.
- State assumptions explicitly, and say exactly what you could not find.`;

// ─────────────────────────── domain types ───────────────────────────
/** Private slice each agent receives through Send — not the whole state. */
interface AgentTaskInput {
  task: Task;
  context: string;
  userProfile: UserProfile;
  round: number;
}

const CLEAR = "__clear__" as const;
type OutputsUpdate = AgentOutput[] | typeof CLEAR;

// ─────────────────────────── small talk ───────────────────────────
const GREETING_REPLY =
  "Hi! I'm a finance chatbot — I can help you with financial information like investing, " +
  "tax, markets, news, portfolios and financial goals. What would you like to know?";

const THANKS_REPLY =
  "You're welcome! I'm a finance chatbot — ask me anything about investing, tax, markets or your financial goals.";

/** Bare greetings/small talk, answered without an LLM call. Anything longer goes to the planner. */
const SMALLTALK =
  /^(hi+|hello+|hey+|hiya|yo|namaste|hola|good (morning|afternoon|evening|day)|how are you( doing)?|what'?s up|sup|who are you|what can you do|thanks?|thank you|thx|ok(ay)?|bye|goodbye)( there| bot| again)?[\s!.?,🙂😊👋]*$/i;

const THANKS = /^(thanks?|thank you|thx|ok(ay)?|bye|goodbye)\b/i;

// ─────────────────────────── state ───────────────────────────
const lastValue = <T,>(def: () => T) => Annotation<T>({ reducer: (_, right) => right, default: def });

export const SupervisorState = Annotation.Root({
  ...MessagesAnnotation.spec, // messages: BaseMessage[] with the standard reducer
  userProfile: lastValue<UserProfile>(() => ({})),
  dispatch: lastValue<Task[]>(() => []),
  pending: lastValue<Task[]>(() => []),
  agentOutputs: Annotation<AgentOutput[], OutputsUpdate>({
    // accumulate within a turn; plan() sends CLEAR so old turns don't leak in
    reducer: (left, right) => (right === CLEAR ? [] : left.concat(right)),
    default: () => [],
  }),
  round: lastValue<number>(() => 0),
  reviewNotes: lastValue<string>(() => ""),
});

export type SupervisorStateType = typeof SupervisorState.State;
type Update = Partial<typeof SupervisorState.Update>;

// ─────────────────────────── structured outputs ───────────────────────────
const TaskSchema = z.object({
  agent: z.enum(AGENTS),
  query: z.string().describe("Self-contained sub-question for this agent."),
  dependsOn: z
    .array(z.enum(AGENTS))
    .describe("Agents whose findings this task needs first. Empty if independent."),
});

const PlanSchema = z.object({
  reasoning: z
    .string()
    .describe("Step by step: the parts of the question, and which specialist + tool answers each."),
  intent: z
    .enum(["smalltalk", "finance"])
    .describe("smalltalk: greetings, thanks, goodbyes, 'who are you'. finance: anything needing a specialist."),
  reply: z
    .string()
    .describe("smalltalk only: the short, friendly reply to send the user. Empty string for finance."),
  tasks: z.array(TaskSchema).max(4).describe("Empty for smalltalk; 1-4 tasks for finance."),
});

const ReviewSchema = z.object({
  reasoning: z.string().describe("Cross-check of all findings: conflicts, gaps, weak assumptions."),
  verdict: z.enum(["sufficient", "needs_follow_up"]),
  followUps: z.array(TaskSchema).max(3).describe("Only when verdict is needs_follow_up."),
  notesForSynthesis: z
    .string()
    .describe("How to reconcile findings: which to trust, caveats, conflicts to explain."),
});

type PlanResult = z.infer<typeof PlanSchema>;
type ReviewResult = z.infer<typeof ReviewSchema>;

const planner = structuredWithFallback<PlanResult>("planner", PlanSchema, "plan");
// The planner owns the answer end to end: it assigns agents, reviews them, and writes the summary.
const reviewer = structuredWithFallback<ReviewResult>("planner", ReviewSchema, "review");
const synthesizer = chatWithFallback("planner");

// ─────────────────────────── prompts ───────────────────────────
const plannerPrompt = (profile: UserProfile): string => `You are the planner of a finance chatbot.
You own the answer: you decide whether any specialist is needed, assign them, and afterwards
you review their findings and write the final summary.

Step 1 — decide the intent of the user's latest message:
- smalltalk: greetings (hi, hello, good morning, namaste), thanks, goodbyes, "how are you",
  or questions about you ("who are you", "what can you do"). Set tasks to [] and write the
  reply yourself in 1-2 friendly sentences. For a greeting or "who are you", always introduce
  yourself as a finance chatbot, e.g. "Hi! I'm a finance chatbot — I can help you with financial
  information like investing, tax, markets, news, portfolios and financial goals. What would you
  like to know?" No disclaimers.
- finance: anything else. Set reply to "" and plan tasks.
A greeting that also asks a finance question ("hi, what is a mutual fund?") is finance.

Step 2 — for finance, reason before assigning (put this in reasoning):
1. What exactly is the user asking? List each part of the question.
2. For each part, which specialist has the knowledge AND the tool to answer it correctly?
3. Does any part need another part's result first? That's dependsOn.

Specialists and their tools:
- finance_qa: concepts and definitions.
  Tools: rag_search (knowledge base, web fallback).
- portfolio: the user's holdings — allocation, concentration, risk, costs, value, profit/loss.
  It automatically receives the user's actual holdings from their Zerodha Kite account, so
  use it for ANY question about "my portfolio / my stocks / my holdings / my P&L".
  Tools: stock_quote, rag_search, sip_future_value, cagr.
- market: live market data — indices, gainers/losers, a stock's price, why the market moved.
  Tools: market_movers, stock_quote, market_search (live finance web).
- goal_planning: goals, horizon, target corpus, required monthly saving.
  Tools: sip_future_value, cagr, rag_search.
- news: recent financial news and why it matters.
  Tools: news_search (past week), market_search.
- tax: tax rules, slabs, deductions, account types.
  Tools: rag_search (tax documents, web fallback).

Rules — use agents only when necessary:
- Assign a specialist only if its tools are needed to answer correctly. One is often enough;
  use more only when the question spans their areas (e.g. "tax on my equity gains this year"
  needs portfolio + tax). Never assign two specialists the same sub-question.
- Anything current (prices, index levels, today's news) needs market or news — the knowledge
  base is static.
- Write each query so the agent can act without seeing the conversation: include the
  jurisdiction, tax year, amounts, symbols and horizon from the message or profile.
- Set dependsOn only when an agent genuinely needs another's findings
  (e.g. tax efficiency of a portfolio dependsOn portfolio).
- Use the user profile below; don't ask agents to re-derive it.

User profile: ${JSON.stringify(profile)}`;

const reviewerPrompt = (round: number, profile: UserProfile): string => `You are the planner, checking the specialists you assigned before anything reaches the user.

Reason step by step over the findings, then decide. Check, in order:
1. Contradictions between agents.
2. Gaps: parts of the user's question no agent answered.
3. Numbers without a tool/source, or stale/undated market data.
4. Assumptions that conflict with the user profile (risk, jurisdiction, horizon).
5. Anything that reads as personalised advice rather than education.

If an agent said it couldn't find something, assign a follow-up to the specialist whose
tools can reach it (current prices → market via stock_quote/market_movers; recent events →
news via news_search; rules → tax or finance_qa via rag_search), with a more specific query.
Ask for follow-ups ONLY if a gap or conflict would materially change the answer and another
agent call can fix it. Otherwise mark sufficient and put caveats in notesForSynthesis.
This is round ${round} of ${MAX_ROUNDS}.

User profile: ${JSON.stringify(profile)}`;

const SYNTH_PROMPT = `You are the planner. You assigned specialists to the user's question; now write
the final reply from their findings and your review notes.

- Answer the user's question directly first, then the supporting detail.
- Merge the findings into one coherent answer — not agent by agent. Where agents
  overlap, keep the best-sourced version; where they conflict, say so and explain.
- Use only the findings provided. Don't add facts of your own.
- Keep citations: [document, page] for knowledge-base passages, URLs for web results.
- Surface the review caveats and anything the specialists couldn't find, plainly.
End with a one-line note that this is educational information, not financial advice.`;

// ─────────────────────────── helpers ───────────────────────────
function toText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (typeof block === "string" ? block : ((block as { text?: string }).text ?? "")))
    .join("");
}

function lastUserText(messages: BaseMessage[]): string {
  const message = [...messages].reverse().find((m) => m.getType() === "human");
  return message ? toText(message.content) : "";
}

const formatOutputs = (outputs: AgentOutput[]): string =>
  outputs
    .map((o) => `### ${o.agent} (round ${o.round})\nTask: ${o.query}\n${o.answer}`)
    .join("\n\n");

function fanOut(state: SupervisorStateType): Send[] {
  const context = formatOutputs(state.agentOutputs);
  return state.dispatch.map(
    (task) =>
      new Send(task.agent, {
        task,
        context,
        userProfile: state.userProfile,
        round: state.round,
      } satisfies AgentTaskInput)
  );
}

// ─────────────────────────── nodes ───────────────────────────
async function plan(
  state: SupervisorStateType,
  config: LangGraphRunnableConfig
): Promise<Update> {
  const userId = (config.configurable?.user_id as string | undefined) ?? "anonymous";
  const item = await config.store?.get(["users", userId], "profile");
  const profile = (item?.value ?? {}) as UserProfile;

  // No specialist needed: reply directly, dispatch nothing, and routeAfterPlan goes to END.
  const smalltalkReply = (reply: string): Update => ({
    userProfile: profile,
    dispatch: [],
    pending: [],
    agentOutputs: CLEAR,
    round: 0,
    reviewNotes: "",
    messages: [new AIMessage({ content: reply, name: "supervisor" })],
  });

  // Bare greetings: instant reply, no LLM call.
  const text = lastUserText(state.messages).trim();
  if (SMALLTALK.test(text)) {
    return smalltalkReply(THANKS.test(text) ? THANKS_REPLY : GREETING_REPLY);
  }

  const result = await planner.invoke(
    [new SystemMessage(plannerPrompt(profile)), ...state.messages.slice(-8)],
    { tags: [NOSTREAM] }
  );

  // Other small talk the planner recognised.
  if (result.intent === "smalltalk" || !result.tasks.length) {
    return smalltalkReply(result.reply.trim() || GREETING_REPLY);
  }

  const tasks: Task[] = result.tasks.map((t) => ({ ...t, dependsOn: t.dependsOn ?? [] }));
  const planned = new Set<AgentName>(tasks.map((t) => t.agent));
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.filter((d) => planned.has(d) && d !== task.agent);
  }

  let ready = tasks.filter((t) => t.dependsOn.length === 0);
  let pending = tasks.filter((t) => t.dependsOn.length > 0);
  if (!ready.length) [ready, pending] = [tasks, []]; // guard against a cyclic plan

  return {
    userProfile: profile,
    dispatch: ready,
    pending,
    agentOutputs: CLEAR,
    round: 1,
    reviewNotes: "",
  };
}

function makeAgentNode(name: AgentName) {
  // A bare model (not a RunnableWithFallbacks) so bindTools works — so the fallback is a second agent.
  const build = (model: ReturnType<typeof getModel>) =>
    createAgent({
      model,
      tools: AGENT_TOOLS[name] as never,
      systemPrompt: AGENT_PROMPTS[name] + SHARED_RULES,
    });
  const agent = build(getModel("agent"));
  const backupModel = getFallbackModel("agent");
  const backup = backupModel ? build(backupModel) : null;

  // The runtime value here is the Send payload, not the graph state.
  return async (state: SupervisorStateType): Promise<Update> => {
    const { task, context, userProfile, round } = state as unknown as AgentTaskInput;

    let content = task.query;
    if (Object.keys(userProfile ?? {}).length) {
      content += `\n\nUser profile: ${JSON.stringify(userProfile)}`;
    }
    if (name === "portfolio") content += await holdingsBlock();
    if (context) {
      content += `\n\nFindings from other specialists so far (build on them, don't repeat them):\n${context}`;
    }

    const run = async (runner: typeof agent): Promise<string> => {
      const result = await runner.invoke({ messages: [new HumanMessage(content)] }, { tags: [NOSTREAM] });
      const messages = result.messages as BaseMessage[];
      return toText(messages[messages.length - 1].content);
    };

    let answer: string;
    try {
      answer = await run(agent);
    } catch (error) {
      console.warn(`[${name}] primary model failed, trying fallback: ${(error as Error).message}`);
      try {
        if (!backup) throw error;
        answer = await run(backup);
      } catch (fallbackError) {
        answer = `[${name} failed: ${(fallbackError as Error).message}]`; // one agent shouldn't sink the turn
      }
    }

    return { agentOutputs: [{ agent: name, query: task.query, answer, round }] };
  };
}

const HOLDING_COLUMNS = [
  "symbol",
  "exchange",
  "quantity",
  "averagePrice",
  "lastPrice",
  "invested",
  "currentValue",
  "pnl",
  "pnlPct",
  "dayChange",
  "dayChangePct",
  "weightPct",
] as const satisfies readonly (keyof Holding)[];

/** The user's Kite holdings as compact JSON for the portfolio agent, or why they're missing. */
async function holdingsBlock(): Promise<string> {
  try {
    const { source, fetchedAt, totals, holdings } = await getPortfolio();
    // Columns + rows instead of one object per holding: under half the tokens, and small local
    // models (4K context) read it reliably where the object form made them ramble.
    const rows = holdings.map((h) => HOLDING_COLUMNS.map((column) => h[column]));
    const json = JSON.stringify({ totals, columns: HOLDING_COLUMNS, rows });
    return `\n\nHoldings JSON (${source}, fetched ${fetchedAt}):\n${json}`;
  } catch (error) {
    return `\n\nHoldings JSON: unavailable (${(error as Error).message}). Say so, and don't guess the holdings.`;
  }
}

/** The supervisor's reasoning step. Must always set `dispatch`. */
async function review(state: SupervisorStateType): Promise<Update> {
  const { round, agentOutputs: outputs, pending, userProfile } = state;

  // 1) Release dependent tasks whose inputs now exist. Deterministic, no LLM call.
  const done = new Set<AgentName>(outputs.map((o) => o.agent));
  const ready = pending.filter((t) => t.dependsOn.every((d) => done.has(d)));
  if (ready.length && round < MAX_ROUNDS) {
    return {
      dispatch: ready,
      pending: pending.filter((t) => !ready.includes(t)),
      round: round + 1,
    };
  }

  // 2) Fast path: one agent answered a simple question.
  if (outputs.length === 1 && !pending.length && round === 1) {
    return { dispatch: [], reviewNotes: "" };
  }

  // 3) Budget exhausted.
  if (round >= MAX_ROUNDS) {
    return { dispatch: [], reviewNotes: "Review budget reached. Flag unresolved gaps or conflicts." };
  }

  // 4) Cross-agent critique.
  const result = await reviewer.invoke(
    [
      new SystemMessage(reviewerPrompt(round, userProfile)),
      new HumanMessage(
        `User question:\n${lastUserText(state.messages)}\n\nFindings:\n${formatOutputs(outputs)}`
      ),
    ],
    { tags: [NOSTREAM] }
  );

  if (result.verdict === "needs_follow_up" && result.followUps.length) {
    return {
      dispatch: result.followUps.map((t) => ({ ...t, dependsOn: [] })),
      round: round + 1,
      reviewNotes: result.notesForSynthesis,
    };
  }
  return { dispatch: [], reviewNotes: result.notesForSynthesis };
}

/** Small talk was answered in plan() — nothing to dispatch means we're done. */
const routeAfterPlan = (state: SupervisorStateType): Send[] | typeof END =>
  state.dispatch.length ? fanOut(state) : END;

const routeAfterReview =(state: SupervisorStateType): Send[] | "synthesize" =>
  state.dispatch.length ? fanOut(state) : "synthesize";

async function synthesize(state: SupervisorStateType): Promise<Update> {
  // Not tagged NOSTREAM: these are the tokens the user sees streaming in.
  const response = (await synthesizer.invoke([
    new SystemMessage(SYNTH_PROMPT),
    new HumanMessage(
      `User question:\n${lastUserText(state.messages)}\n\n` +
        `Specialist findings:\n${formatOutputs(state.agentOutputs)}\n\n` +
        `Reviewer notes:\n${state.reviewNotes || "None"}`
    ),
  ])) as AIMessage;
  return { messages: [new AIMessage({ content: toText(response.content), name: "supervisor" })] };
}

// ─────────────────────────── graph ───────────────────────────
export interface BuildOptions {
  checkpointer?: BaseCheckpointSaver;
  store?: BaseStore;
}

export function buildGraph({ checkpointer, store }: BuildOptions = {}) {
  // Register agents via the record form so their names are part of the graph's node type.
  const agentNodes = Object.fromEntries(AGENTS.map((name) => [name, makeAgentNode(name)])) as Record<
    AgentName,
    ReturnType<typeof makeAgentNode>
  >;

  const builder = new StateGraph(SupervisorState)
    .addNode("plan", plan)
    .addNode("review", review)
    .addNode("synthesize", synthesize)
    .addNode(agentNodes);

  for (const name of AGENTS) {
    builder.addEdge(name, "review"); // parallel agents converge; review runs once per round
  }

  builder
    .addEdge(START, "plan")
    .addConditionalEdges("plan", routeAfterPlan, [...AGENTS, END])
    .addConditionalEdges("review", routeAfterReview, [...AGENTS, "synthesize"])
    .addEdge("synthesize", END);

  return builder.compile({ checkpointer, store });
}

// Exported for langgraph.json — the dev server injects persistence and the store.
export const graph = buildGraph();
