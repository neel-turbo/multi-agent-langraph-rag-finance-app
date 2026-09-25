# Finance Agents (multi-agent-langraph-rag-finance-app)

A multi-agent financial education assistant for Indian and world markets. A LangGraph.js
supervisor plans each question, sends it to six specialist agents that run in parallel,
checks what they found, and writes one answer. The agents can search your own PDFs (local RAG),
read live market data, and see your Zerodha Kite holdings.

React frontend, TypeScript throughout, one app folder.

> Educational information only — not financial advice.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Agents and tools](#agents-and-tools)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Start the ChromaDB server](#start-the-chromadb-server)
- [Running the app](#running-the-app)
- [Knowledge base (RAG)](#knowledge-base-rag)
- [Portfolio (Zerodha Kite)](#portfolio-zerodha-kite)
- [Conversations and memory](#conversations-and-memory)
- [Models: switching LLM providers](#models-switching-llm-providers)
- [HTTP API](#http-api)
- [Configuration reference](#configuration-reference)
- [npm scripts](#npm-scripts)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

---

## Features

- **Supervisor with real reasoning.** It plans which specialists a question needs, runs
  them in parallel, reviews their findings for conflicts and gaps, asks follow-ups if
  needed (up to 3 rounds), then writes the final answer.
- **Six specialist agents.** Finance Q&A, Portfolio, Market, Goal Planning, News and Tax.
  Each one is a ReAct agent with its own tools.
- **Local RAG over your PDFs.** PDFs are parsed locally with LiteParse, embedded locally
  with `bge-small`, and stored in ChromaDB. Answers cite `[document, page]`. If nothing
  relevant is found, the search falls back to the web.
- **Market data.** Nifty, Sensex and world indices, top gainers and losers with sparklines,
  and a live ticker. Uses Yahoo by default, so no API key is needed.
- **Portfolio.** Holdings come from Zerodha Kite as JSON. They go to the Portfolio agent and
  are shown on a Portfolio screen: summary tiles, allocation, P&L per holding, price
  history and a holdings table.
- **Conversations.** "New conversation" starts a fresh chat. Past chats are listed in a side
  panel and can be reopened and continued at any time.
- **Memory.** Every chat is checkpointed by the LangGraph server, and user profiles persist
  across chats.
- **Responsive UI.** Three columns on desktop, two on tablets, one on phones (the
  conversation list folds into a toggle).

---

## How it works

Four processes run side by side:

```
 Browser (React, :5173)
   │  chat stream, conversation list          │  market + portfolio JSON
   ▼                                           ▼
 LangGraph server (:2024)                    API server (:8787)
   supervisor graph + agents                   market snapshots, Kite holdings,
   │           │            │                  price history
   ▼           ▼            ▼                          │
 ChromaDB    LLM: Gemini, Yahoo, Tavily,               ▼
 (:8000)     Claude,      Kite                    Yahoo, Kite
             OpenAI or
             Ollama
```

What happens to each question inside the supervisor graph:

```
plan ──Send──▶ agents (parallel) ──▶ review ──┬──Send──▶ agents ──▶ review ...
  │                                           └──────▶ synthesize ──▶ END
  └── small talk ──▶ END
```

1. **plan**: bare greetings are answered instantly by a regex, with no model call. Otherwise
   the planner splits the question into tasks and assigns each one to the specialist whose
   tools can answer it. A task can depend on another task's result.
2. **agents**: each assigned specialist runs a ReAct loop (think, call a tool, observe,
   repeat) and returns cited findings. Independent agents run in parallel.
3. **review**: releases tasks whose dependencies are now met, then cross-checks the findings
   for contradictions, gaps and unsourced numbers. It can send follow-up tasks for up to
   3 rounds.
4. **synthesize**: merges everything into one answer and streams it to the browser.

The code is in `src/server/graph/supervisorGraph.ts`.

---

## Agents and tools

| Agent             | What it handles                                                    | Tools                                                                                  |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Finance Q&A**   | Concepts and definitions, explained for a learner                  | `rag_search`                                                                           |
| **Portfolio**     | Your holdings: allocation, concentration, risk, P&L                | Kite holdings JSON (injected), `stock_quote`, `rag_search`, `sip_future_value`, `cagr` |
| **Market**        | Indices, gainers and losers, a stock's price, why the market moved | `market_movers`, `stock_quote`, `market_search`                                        |
| **Goal Planning** | Target corpus, horizon, required monthly saving                    | `sip_future_value`, `cagr`, `rag_search`                                               |
| **News**          | Recent financial news and why it matters                           | `news_search`, `market_search`                                                         |
| **Tax**           | Tax rules, slabs, deductions, account types                        | `rag_search`                                                                           |

| Tool               | What it does                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rag_search`       | Searches your ingested PDFs in ChromaDB, filtered by `domain`, `jurisdiction`, `taxYear` and `tablesOnly`. Falls back to Tavily web search when nothing scores above the similarity threshold. |
| `stock_quote`      | Price and recent range for one stock or index (`RELIANCE.NS`, `^NSEI`, `AAPL`, …).                                                                                                             |
| `market_movers`    | Index levels plus top gainers and losers for `india`, `world` or `both`.                                                                                                                       |
| `market_search`    | Live finance web search (Tavily).                                                                                                                                                              |
| `news_search`      | News from the past week (Tavily).                                                                                                                                                              |
| `sip_future_value` | Future value of a monthly SIP.                                                                                                                                                                 |
| `cagr`             | Compound annual growth rate between two values.                                                                                                                                                |

---

## Prerequisites

| Requirement                             | Why                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| **Node.js 20+**                         | Runs everything                                                                        |
| **An LLM API key**                      | Gemini by default; or Claude or OpenAI (see [Models](#models-switching-llm-providers)) |
| **Tavily API key**                      | Web, news and market search, and the RAG web fallback                                  |
| **ChromaDB**                            | Vector database for your PDFs                                                          |
| [Ollama](https://ollama.com) (optional) | Local model: the default fallback, or a fully local setup                              |

Get the keys here:

- Gemini: <https://aistudio.google.com/apikey>
- Claude: <https://console.anthropic.com/settings/keys>
- OpenAI: <https://platform.openai.com/api-keys>
- Tavily: <https://app.tavily.com>

Market data (Yahoo) and the Kite demo portfolio need no key.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
#    then set TAVILY_API_KEY and your LLM key (GOOGLE_API_KEY by default) in .env

# 3. Start ChromaDB in a separate terminal and leave it running
#    (see "Start the ChromaDB server")
npx chroma run --path ./local-db-data

# 4. Ingest your PDFs (one time per document; see "Knowledge base")
mkdir -p pdfs            # put your PDFs here
npm run ingest -- pdfs --domain general

# 5. Optional: pull a local fallback model
ollama pull qwen3.5:4b   # must support tool calling

# 6. Start the app
npm run dev
```

Open <http://localhost:5173>.

---

## Start the ChromaDB server

ChromaDB is the vector database that stores your embedded PDFs. It runs as its own server
on port **8000**, and it must be running **before** you ingest PDFs and **whenever** you use
the app. `npm run dev` does **not** start it.

```bash
npx chroma run --path ./local-db-data
```

- **`npx chroma`:** the Chroma CLI comes with the project's `chromadb` npm package, so
  `npm install` is enough. You don't need Python or Docker.
- **`run`:** starts the server on `http://localhost:8000`.
- **`--path ./local-db-data`:** the folder where Chroma saves its data (`chroma.sqlite3`
  plus index files). Your embedded PDFs live here and survive restarts.

Open a **separate terminal** for it and leave it running. Stop it with `Ctrl+C`; your data
stays on disk.

Other options:

```bash
npx chroma run --path ./local-db-data --port 8001        # a different port
                                                         # (also set CHROMA_URL=http://localhost:8001 in .env)
npx chroma run --help                                     # all options

# With Docker instead of npx:
docker run -p 8000:8000 -v ./local-db-data:/data chromadb/chroma
```

**Check it's running:**

```bash
curl http://localhost:8000/api/v2/heartbeat
# {"nanosecond heartbeat": 1790353418603796000}
```

**Important:**

- **Always use the same `--path`.** Chroma reads only the folder you give it. If you start
  it with a different path (or none), it opens an empty database: agents find nothing in
  your PDFs and fall back to web search.
- **Ingesting needs Chroma running.** `npm run ingest` writes to the server at `CHROMA_URL`
  (default `http://localhost:8000`). Without it, ingest fails to connect.
- **If Chroma is down while you chat**, the app still works: `rag_search` falls back to web
  search, and answers cite web pages instead of your documents.
- **Keep `local-db-data/` out of git.** It's a large, machine-specific database, so add it
  to `.gitignore`.

---

## Running the app

`npm run dev` starts three processes, with colour-coded output:

| Process     | Port | What                          |
| ----------- | ---- | ----------------------------- |
| `dev:web`   | 5173 | Vite / React frontend         |
| `dev:graph` | 2024 | LangGraph server (the agents) |
| `dev:api`   | 8787 | Market and portfolio data API |

ChromaDB is **not** part of `npm run dev`. Start it first in its own terminal with
`npx chroma run --path ./local-db-data`
(see [Start the ChromaDB server](#start-the-chromadb-server)).

A full local session uses two terminals:

```bash
# Terminal 1: vector database
npx chroma run --path ./local-db-data

# Terminal 2: web + agents + API
npm run dev
```

### Screens

- **Chat** (`#/`): the conversation list on the left, the chat in the middle, and market
  movers on the right. While an answer is being worked on, the chat shows live progress
  such as "Planned: Portfolio analysis" and "Writing the answer".
- **Portfolio** (`#/portfolio`):
  - summary tiles (current value, invested, total P&L, today's change)
  - allocation by value, and P&L per holding
  - price history for the selected stock, with your average buy price
  - the full holdings table

  Click a bar or table row to chart that stock.

---

## Knowledge base (RAG)

Your PDFs become a searchable knowledge base in four steps. Everything runs on your
machine: no parsing API, no embedding API, and no document leaves your computer.

```
PDF ──LiteParse──▶ Markdown, page by page ──chunker──▶ chunks + metadata
    ──bge-small (local)──▶ vectors ──▶ ChromaDB "finance_docs"
```

| Step     | Code                         | What happens                                                           |
| -------- | ---------------------------- | ---------------------------------------------------------------------- |
| 1. Parse | `src/server/rag/ingest.ts`   | LiteParse turns each PDF page into Markdown                            |
| 2. Chunk | `src/server/rag/chunk.ts`    | Markdown is split into chunks, each tagged with page, section and type |
| 3. Embed | `src/server/rag/embedder.ts` | Each chunk becomes a 384-number vector, computed locally               |
| 4. Store | `src/server/rag/ingest.ts`   | Vectors, text and metadata are written to ChromaDB                     |

### Ingest command

Start the ChromaDB server first (`npx chroma run --path ./local-db-data`); ingest writes
to it.

```bash
npm run ingest -- <pdf-file-or-folder> [flags]

npm run ingest -- pdfs/tax_guide_2025.pdf --domain tax --jurisdiction IN --tax-year 2025
npm run ingest -- pdfs --domain investing          # a whole folder, including subfolders
npm run ingest -- pdfs/scanned_form.pdf --ocr      # a scanned (image-only) PDF
```

| Flag             | Values                            | Default   | Stored as metadata | Purpose                                                |
| ---------------- | --------------------------------- | --------- | ------------------ | ------------------------------------------------------ |
| `--domain`       | `general` \| `tax` \| `investing` | `general` | `domain`           | Lets agents narrow their search (Tax searches `tax`)   |
| `--jurisdiction` | e.g. `IN`, `US`                   | none      | `jurisdiction`     | Filters tax searches by country                        |
| `--tax-year`     | e.g. `2025`                       | none      | `taxYear`          | Filters tax searches by year                           |
| `--ocr`          | (flag)                            | off       | none               | Reads text from images, for scanned PDFs. Much slower. |

Flags apply to every PDF in that run. To tag files differently (e.g. Indian vs US tax
guides), ingest them in separate runs.

Example output:

```
Found 3 PDF(s)
done  tax_guide_2025.pdf: 84 pages -> 312 chunks (41 tables)
skip  scanned_notice.pdf (no extractable text — try --ocr)
Collection now holds 6942 chunks.
```

### Step 1: parsing with LiteParse

[LiteParse](https://www.npmjs.com/package/@llamaindex/liteparse) (`@llamaindex/liteparse`)
is LlamaIndex's **local** PDF parser. It's written in Rust, runs inside Node, and needs no
API key and no ML model. It turns PDF layout into Markdown, so headings stay headings and
tables stay tables.

LiteParse returns a whole document as one Markdown string with no page markers. To keep
page numbers for citations, `ingest.ts` parses one page at a time:

1. **Page count:** a quick text-only pass (`outputFormat: "text"`) counts the pages.
2. **Each page:** the page is parsed again as Markdown with these options:

   | Option         | Value           | Effect                                                                                       |
   | -------------- | --------------- | -------------------------------------------------------------------------------------------- |
   | `outputFormat` | `"markdown"`    | Keeps structure: `#` headings, `\|` tables, lists                                            |
   | `targetPages`  | the page number | Parses just that page                                                                        |
   | `imageMode`    | `"placeholder"` | Keeps `![](image_pN_K.png)` references where images were. The images themselves aren't read. |
   | `extractLinks` | `true`          | Keeps hyperlinks as Markdown links                                                           |
   | `ocrEnabled`   | `--ocr` flag    | Off by default. Turn it on only for scanned PDFs, where the text is inside images.           |

3. **Page markers:** before each page's Markdown, `ingest.ts` inserts a separator line,
   `{0}------…` for page 1, `{1}------…` for page 2, and so on. The chunker reads these to
   know which page each chunk came from.

If a PDF has no extractable text, it's skipped with a hint to use `--ocr`. This is common
for scans.

### Step 2: chunking

`chunk.ts` turns each page's Markdown into chunks sized for the embedding model. It walks
each page block by block (blocks are separated by blank lines) and applies these rules:

- **Headings** (`# …`) start a new chunk and become that chunk's `section`. The heading is
  also added to the top of the chunk's text (`## Section name`), so the chunk makes sense
  on its own when an agent reads it.
- **Tables** (2 or more lines starting with `|`) always get a chunk of their own and are
  **never split**, so a tax slab table stays whole.
- **Image placeholders** (`![…](…)`) are marked as type `image`.
- **Text** fills a chunk up to **1,800 characters (about 450 tokens)**, which is within
  bge-small's 512-token limit. A paragraph longer than that is split at sentence
  boundaries.
- **Tiny text chunks** under 120 characters are dropped. These are stray page numbers,
  footers and similar noise. Tables and images are always kept.
- **Page boundaries:** chunks never cross from one page to the next, so every chunk has
  exactly one page number.

A chunk that contains a table gets the type `table`. Otherwise, one with an image
placeholder gets `image`, and everything else gets `text`.

### Step 3: embedding

`embedder.ts` runs **`Xenova/bge-small-en-v1.5`** locally through
[Transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`),
with no Python needed.

- **First run:** the model (about 130 MB) is downloaded once and cached. Later runs work
  offline.
- **Vectors:** 384 numbers per chunk, CLS pooling, normalised, fp32. Chunks are embedded in
  batches of 16.
- **Queries are different:** a search question is prefixed with `Represent this sentence
for searching relevant passages: `, as bge recommends. Stored passages get no prefix.

### Step 4: storing in ChromaDB

Chunks go into the **`finance_docs`** collection, which uses cosine distance
(`hnsw:space: cosine`). They're written in batches of 100.

| Stored field | Value                                            |
| ------------ | ------------------------------------------------ |
| `id`         | `<docId>_c<chunkIndex>`, e.g. `a1b2c3d4e5f6_c17` |
| `document`   | The chunk text (with its `## Section` heading)   |
| `embedding`  | The 384-number vector                            |
| `metadata`   | See the table below                              |

**Metadata on every chunk:**

| Field          | Example                    | Always set?                   | Meaning                                                             |
| -------------- | -------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `docId`        | `a1b2c3d4e5f6`             | Yes                           | First 12 hex characters of the SHA-1 hash of the PDF's **contents** |
| `source`       | `tax_guide_2025.pdf`       | Yes                           | File name (no folder); shown in citations                           |
| `chunkIndex`   | `17`                       | Yes                           | Position of the chunk within its document                           |
| `elementType`  | `text` / `table` / `image` | Yes                           | What the chunk contains                                             |
| `domain`       | `tax`                      | Yes                           | From `--domain`                                                     |
| `charCount`    | `1642`                     | Yes                           | Length of the chunk text                                            |
| `ingestedAt`   | `2026-09-25`               | Yes                           | Date it was ingested                                                |
| `page`         | `42`                       | When known                    | Page number, starting at 1; shown in citations                      |
| `section`      | `Capital gains on equity`  | When under a heading          | Nearest heading above the chunk (up to 120 characters)              |
| `jurisdiction` | `IN`                       | If `--jurisdiction` was given | For tax filters                                                     |
| `taxYear`      | `2025`                     | If `--tax-year` was given     | For tax filters                                                     |

Chroma metadata can only hold strings, numbers and booleans, so a field that has no value
is left out rather than stored as `null`.

### How agents search it (`rag_search`)

`src/server/tools/ragTool.ts` is the search tool the Finance Q&A, Portfolio, Goal Planning
and Tax agents use.

1. **Embed the question** with the query prefix.
2. **Filter by metadata.** The agent chooses the filters:
   - `domain`: `tax` or `investing` limits the search to chunks with that domain.
     `general` searches every domain.
   - `jurisdiction` and `taxYear` (when given) match exactly.
   - `tablesOnly: true` searches only `elementType = table` chunks. The Tax agent uses this
     for rates and slabs.
3. **Retrieve the top 6** closest chunks.
4. **Keep only relevant ones.** A chunk is kept if its similarity (1 − cosine distance) is
   at least `RAG_MIN_SIMILARITY`, default `0.68`. With bge-small on this index, on-topic
   tax questions scored 0.71–0.88 and off-topic ones 0.52–0.63.
5. **Return passages with their citation**, e.g. `[tax_guide_2025.pdf, page 42 — Capital
gains on equity]`. Agents are told to cite every fact as `[document, page]`.
6. **Web fallback.** If no chunk passes the threshold, or Chroma can't be reached, the tool
   searches the web with Tavily instead and says so. The agent keeps working instead of
   failing.

### Do I need to ingest again?

No. Ingesting is a one-time step per document. The vectors are stored on disk in
`local-db-data/`, and `rag_search` reads them on every question, as long as Chroma is
running.

| Situation                                                                 | What to do                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| You add a new PDF                                                         | `npm run ingest -- pdfs/new.pdf --domain …`. Existing chunks are kept.                                  |
| You re-run ingest on the **same, unchanged** file (e.g. to fix its flags) | It has the same `docId`, so its old chunks are deleted and replaced. No duplicates.                     |
| You **edit** a PDF and ingest it again                                    | The edited file has a new `docId`, so **the old version's chunks stay**. Delete them first (below).     |
| You change `EMBED_MODEL`                                                  | Delete the collection and ingest **everything** again. Vectors from different models can't be compared. |

To start from an empty knowledge base, stop Chroma, delete `local-db-data/`, start Chroma
again, and re-ingest your PDFs.

### Checking what's in the database

With Chroma running:

```bash
# Collections and their ids
curl -s http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections

# Chunk count (put the finance_docs id in place of <id>)
curl -s http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/<id>/count
```

---

## Portfolio (Zerodha Kite)

Holdings are fetched as JSON from Kite's `/portfolio/holdings`, normalised in
`src/server/portfolio/kite.ts`, and cached for 60 seconds. They're used in two places:

- **The Portfolio agent** gets the holdings in its task as compact JSON: totals, then
  columns and rows. It doesn't need to call a tool to see them. The planner sends any
  "my portfolio / my stocks / my P&L" question to this agent.
- **The Portfolio screen** loads them through `GET /api/portfolio`.

### Demo account (default)

With no Kite keys set, the app reads Zerodha's public demo account at
`https://kite-demo.zerodha.com` (user `DEMOUSER`, 17 equity holdings). **Its prices are a
fixed snapshot from 2023.** The price-history chart uses real current prices from Yahoo,
so the two won't match.

### Your real account

1. Create an app at <https://developers.kite.trade> to get an API key.
2. Complete the Kite Connect login flow to get an access token.
3. Set both in `.env`:

   ```env
   KITE_API_KEY=your_api_key
   KITE_ACCESS_TOKEN=your_access_token
   ```

4. Restart `npm run dev`.

The app then reads `https://api.kite.trade/portfolio/holdings`. Kite access tokens expire
every day, so you'll need a new token each trading day.

---

## Conversations and memory

- Each chat is a LangGraph **thread**. The first message creates the thread and tags it
  with `user_id`. The side panel lists that user's threads, newest first, titled by their
  first message.
- **New conversation** clears the current thread. The next message starts a new one.
- Clicking a past conversation loads its history, and you can keep chatting in it.
- The browser remembers the open conversation (in `localStorage`) and reopens it after a
  reload. If the server no longer has that thread, the chat starts a new one.
- The dev server stores threads under `.langgraph_api/` on local disk.
- The user is hardcoded as `userId = "u1"` in `src/App.tsx` until authentication is added.
- **Long-term profile:** the planner reads `["users", <user_id>] / "profile"` from the
  LangGraph store (risk, horizon, jurisdiction, …) and passes it to the agents.

---

## Models: switching LLM providers

The agents can run on four providers. You switch between them in `.env` without changing
any code:

| Provider value | LLM                  | Key in `.env`       | Model setting (default)             |
| -------------- | -------------------- | ------------------- | ----------------------------------- |
| `google-genai` | Google Gemini        | `GOOGLE_API_KEY`    | `GOOGLE_MODEL` (`gemini-2.5-flash`) |
| `anthropic`    | Anthropic Claude     | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (`claude-opus-5`) |
| `openai`       | OpenAI               | `OPENAI_API_KEY`    | `OPENAI_MODEL` (`gpt-5`)            |
| `ollama`       | Local model (Ollama) | none                | `OLLAMA_MODEL` (`qwen3.5:4b`)       |

The code is in `src/server/graph/models.ts`. Each provider uses its LangChain package
(`@langchain/google-genai`, `@langchain/anthropic`, `@langchain/openai`,
`@langchain/ollama`).

### Switch every agent to one provider

Set `LLM_PROVIDER`, add that provider's key, and restart `npm run dev`.

**Claude:**

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5         # optional; this is the default
```

**OpenAI:**

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5                    # use a model your OpenAI account has access to
```

**Gemini** (the default):

```env
LLM_PROVIDER=google-genai
GOOGLE_API_KEY=AIza...
GOOGLE_MODEL=gemini-2.5-flash
```

**Fully local** (no API key, no cost; much slower and less accurate):

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:4b               # must support tool calling; `ollama pull` it first
LLM_FALLBACK_PROVIDER=none
```

### Fallback provider

If the primary provider fails (quota, rate limit, outage), each call is retried on the
fallback provider automatically. This applies to planning, review, the final answer and
the specialist agents.

```env
LLM_FALLBACK_PROVIDER=ollama          # default
LLM_FALLBACK_PROVIDER=google-genai    # e.g. Claude primary, Gemini backup
LLM_FALLBACK_PROVIDER=none            # no fallback
```

The fallback uses that provider's model setting (`GOOGLE_MODEL`, `OLLAMA_MODEL`, …). If its
API key is missing, the app starts anyway without a fallback and prints a warning.

### Mix providers per role

Roles can use different providers. For example, the strongest model for planning and a
cheaper one for the many agent calls:

```env
PLANNER_PROVIDER=anthropic            # planning, review and the final answer
PLANNER_MODEL=claude-opus-5
AGENT_PROVIDER=openai                 # the specialists' tool loops
AGENT_MODEL=gpt-5-mini
AGENT_FALLBACK_PROVIDER=none          # per-role fallback override
```

The variables are `<ROLE>_PROVIDER`, `<ROLE>_MODEL` and `<ROLE>_FALLBACK_PROVIDER`. A role
without `<ROLE>_MODEL` uses its provider's model setting, so `AGENT_PROVIDER=ollama` alone
picks `OLLAMA_MODEL`.

| Role          | Used for                                                      |
| ------------- | ------------------------------------------------------------- |
| `planner`     | Planning, review **and** the final answer                     |
| `agent`       | The specialists' tool-calling loops                           |
| `reviewer`    | Defined, but not currently used: review runs on `planner`     |
| `synthesizer` | Defined, but not currently used: the answer runs on `planner` |

So in practice, `PLANNER_*` and `AGENT_*` are the overrides that take effect.

### Check what's running

The graph server prints each role's model at startup:

```
[models] planner: anthropic/claude-opus-5 (fallback ollama/qwen3.5:4b)
[models] agent: openai/gpt-5-mini (no fallback)
```

Configuration mistakes stop the server at startup with a clear message, instead of failing
on the first question:

```
Error: planner uses anthropic, but ANTHROPIC_API_KEY is not set in .env.
Error: LLM_PROVIDER=claude is not a provider. Use one of: google-genai, anthropic, openai, ollama.
```

### Provider notes

- **Claude:** requests don't send `temperature`, because current Claude models reject
  sampling parameters. Thinking is adaptive by default. Structured output (the planner's
  JSON) uses Claude's native JSON-schema output rather than a forced tool call, which isn't
  allowed while thinking is on. Answers can be up to 16,000 tokens.
- **OpenAI:** requests don't send `temperature`, because GPT-5-family reasoning models
  reject custom values. Structured output uses OpenAI's JSON-schema mode.
- **Gemini and Ollama:** `temperature: 0`, for consistent answers.
- **Model choice:** the agents need reliable tool calling and structured output. Small
  local models (about 4B parameters, 4K context) are slow and less accurate for this
  workload, so they work best as the fallback.
- **Cost:** each question makes several model calls (plan, one or more agents, review,
  answer). Use the per-role overrides to put the frequent `agent` calls on a cheaper model.

---

## HTTP API

Served by `dev:api` on port 8787. CORS allows `WEB_ORIGIN` only.

| Method | Path                                              | Returns                                               |
| ------ | ------------------------------------------------- | ----------------------------------------------------- |
| GET    | `/api/health`                                     | `{ "status": "ok" }`                                  |
| GET    | `/api/market/snapshot`                            | Indices, tickers, gainers and losers for both regions |
| GET    | `/api/market/snapshot?region=india`               | One region (`india` \| `world`)                       |
| GET    | `/api/portfolio`                                  | `PortfolioSnapshot`: holdings plus totals             |
| GET    | `/api/portfolio/history?symbol=SBIN&exchange=NSE` | `PriceHistory`: about 6 months of daily closes        |

Response types are defined in `src/shared/types.ts`.

The agents themselves are served by the LangGraph server on port 2024, using the standard
LangGraph API (`/threads`, `/runs`, …). The graph's name there is `supervisor`.

---

## Configuration reference

Every setting is an environment variable in `.env`.

### Models

| Variable                   | Default                  | Notes                                                     |
| -------------------------- | ------------------------ | --------------------------------------------------------- |
| `LLM_PROVIDER`             | `google-genai`           | `google-genai` \| `anthropic` \| `openai` \| `ollama`     |
| `LLM_FALLBACK_PROVIDER`    | `ollama`                 | Same values, or `none`                                    |
| `GOOGLE_API_KEY`           | —                        | Required when using Gemini                                |
| `GOOGLE_MODEL`             | `gemini-2.5-flash`       |                                                           |
| `ANTHROPIC_API_KEY`        | —                        | Required when using Claude                                |
| `ANTHROPIC_MODEL`          | `claude-opus-5`          |                                                           |
| `OPENAI_API_KEY`           | —                        | Required when using OpenAI                                |
| `OPENAI_MODEL`             | `gpt-5`                  |                                                           |
| `OLLAMA_BASE_URL`          | `http://localhost:11434` |                                                           |
| `OLLAMA_MODEL`             | `qwen3.5:4b`             | Must support tool calling                                 |
| `<ROLE>_PROVIDER`          | `LLM_PROVIDER`           | `PLANNER_`, `AGENT_` (`REVIEWER_`, `SYNTHESIZER_` unused) |
| `<ROLE>_MODEL`             | that provider's model    | Per-role model override                                   |
| `<ROLE>_FALLBACK_PROVIDER` | `LLM_FALLBACK_PROVIDER`  | Per-role fallback, or `none`                              |

### Search and RAG

| Variable             | Default                    | Notes                                          |
| -------------------- | -------------------------- | ---------------------------------------------- |
| `TAVILY_API_KEY`     | —                          | **Required** for web, news and market search   |
| `CHROMA_URL`         | `http://localhost:8000`    |                                                |
| `EMBED_MODEL`        | `Xenova/bge-small-en-v1.5` | Changing it means ingesting everything again   |
| `RAG_MIN_SIMILARITY` | `0.68`                     | Below this score, search falls back to the web |

### Market data

| Variable                        | Default                    | Notes                                       |
| ------------------------------- | -------------------------- | ------------------------------------------- |
| `MARKET_PROVIDER`               | `yahoo`                    | `yahoo` \| `twelve-data` \| `alpha-vantage` |
| `MARKET_QUOTE_TTL_MS`           | `120000`                   | Quote cache lifetime                        |
| `MARKET_SERIES_TTL_MS`          | `21600000` (6 h)           | Sparkline cache lifetime                    |
| `MARKET_CACHE_FILE`             | `./data/market-cache.json` | Alpha Vantage disk cache                    |
| `YAHOO_CONCURRENCY`             | `2`                        | Parallel Yahoo requests                     |
| `YAHOO_MIN_GAP_MS`              | `250`                      | Spacing between Yahoo requests              |
| `TWELVE_DATA_API_KEY`           | —                          | When `MARKET_PROVIDER=twelve-data`          |
| `TWELVE_DATA_DAILY_LIMIT`       | `800`                      |                                             |
| `ALPHA_VANTAGE_API_KEY`         | —                          | When `MARKET_PROVIDER=alpha-vantage`        |
| `ALPHA_VANTAGE_DAILY_BUDGET`    | `25`                       | Free-tier daily cap                         |
| `ALPHA_VANTAGE_MIN_INTERVAL_MS` | `13000`                    | 5 calls/min                                 |
| `ALPHA_VANTAGE_TTL_MS`          | `43200000` (12 h)          |                                             |

### Portfolio

| Variable            | Default                         | Notes                                |
| ------------------- | ------------------------------- | ------------------------------------ |
| `KITE_API_KEY`      | —                               | Set with the token for real holdings |
| `KITE_ACCESS_TOKEN` | —                               | Blank = demo account                 |
| `KITE_DEMO_URL`     | `https://kite-demo.zerodha.com` |                                      |
| `KITE_TTL_MS`       | `60000`                         | Holdings cache lifetime              |

### Servers and browser

| Variable             | Default                 | Notes                             |
| -------------------- | ----------------------- | --------------------------------- |
| `MARKET_API_PORT`    | `8787`                  | API server port                   |
| `WEB_ORIGIN`         | `http://localhost:5173` | CORS origin allowed by the API    |
| `VITE_LANGGRAPH_URL` | `http://localhost:2024` | Public (bundled into the browser) |
| `VITE_MARKET_API`    | `http://localhost:8787` | Public (bundled into the browser) |

Anything prefixed `VITE_` is visible in the browser. Never put a secret there.

---

## npm scripts

| Script              | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Starts web, graph and api together                 |
| `npm run dev:web`   | Vite only                                          |
| `npm run dev:graph` | LangGraph dev server only (port 2024)              |
| `npm run dev:api`   | Market and portfolio API only (port 8787)          |
| `npm run ingest`    | Ingests PDFs into ChromaDB                         |
| `npm run typecheck` | Type-checks the browser and server projects        |
| `npm run build`     | Type-checks, then builds the frontend into `dist/` |
| `npm run preview`   | Serves the built frontend                          |

---

## Project layout

```
src/
  App.tsx                   header, Chat/Portfolio navigation (hash routes)
  main.tsx                  React entry
  styles.css                layout, responsive breakpoints, portfolio styles
  components/               browser only
    ChatScreen.tsx          conversation list + chat + market panel
    ConversationList.tsx    past conversations (LangGraph threads)
    SupervisorChat.tsx      the chat: streaming, progress, errors
    PortfolioScreen.tsx     tiles, charts, holdings table
    MarketMarquee.tsx       sticky ticker
    MoversPanel.tsx         top gainers and losers
    Sparkline.tsx           tiny SVG chart
  hooks/                    browser only
    langgraph.ts            shared LangGraph SDK client
    useMarketSnapshot.ts    shared, polled market snapshot
    usePortfolio.ts         holdings + price history
  shared/
    types.ts                types used by both browser and server
  server/                   Node only; never import from components
    graph/
      supervisorGraph.ts    plan → agents → review → synthesize
      models.ts             per-role model registry and fallbacks
    tools/                  what agents can call (RAG, market, search, calculators)
    rag/                    PDF parsing, chunking, embedding, ingest CLI
    market/                 providers (Yahoo, Twelve Data, Alpha Vantage), watchlists
    portfolio/kite.ts       Zerodha Kite holdings → PortfolioSnapshot
    api/server.ts           HTTP API for the browser
langgraph.json              registers the `supervisor` graph for the LangGraph server
local-db-data/              ChromaDB data (your embedded PDFs)
pdfs/                       source PDFs to ingest
```

`tsconfig.app.json` excludes `src/server`. If a component imports server code, you get a
compile error instead of a leaked API key.

---

## Troubleshooting

| Symptom                                                                   | Cause and fix                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Couldn't reach the assistant"**                                        | The LangGraph server isn't running on 2024, or it crashed while loading. Check the `graph` output of `npm run dev`. The red error message shows the underlying error.         |
| `EADDRINUSE` / port already in use                                        | An old dev process is still running. Find it with `lsof -iTCP:2024 -sTCP:LISTEN` (or `8787`, `5173`) and stop it.                                                             |
| Graph server hangs after you save a file ("Process didn't exit… killing") | The dev watcher sometimes fails to restart, especially when memory is low. Stop it and run `npm run dev:graph` again.                                                         |
| `ERR_PACKAGE_PATH_NOT_EXPORTED … @langchain/core`                         | Mismatched LangChain versions. Every `@langchain/*` package needs `@langchain/core` 1.x. Run `npm ls @langchain/core` and look for `invalid`.                                 |
| `npm run ingest` fails with a connection error                            | The ChromaDB server isn't running. Start `npx chroma run --path ./local-db-data` in another terminal, then ingest again.                                                      |
| Answers cite the web instead of your PDFs                                 | ChromaDB isn't running, or it points at the wrong folder. Start `npx chroma run --path ./local-db-data`, then check that `finance_docs` has chunks.                           |
| `[yahoo] SYMBOL: fetch failed`                                            | A temporary network error or Yahoo rate limit. Refresh; it retries on the next request.                                                                                       |
| Portfolio screen: "Couldn't load your portfolio"                          | `dev:api` isn't running on 8787, or Kite is unreachable. With real keys, the access token has probably expired (they last one day).                                           |
| Very slow or garbled answers                                              | A small local model is being used, either as a fallback or through an override. Check the `[models]` startup log, and make sure your provider's API key is set and has quota. |

---

## Known limits

- Market movers are ranked within the watchlists in `src/server/market/watchlists.ts`,
  not the whole market.
- `yahoo-finance2` is an unofficial API. If it breaks, set `MARKET_PROVIDER=twelve-data`
  with a key.
- The Kite demo account's prices are a fixed 2023 snapshot. Only equity holdings are read,
  not F&O positions.
- There's no authentication yet: `userId` is hardcoded in `src/App.tsx`, so all
  conversations belong to one user.
- The LangGraph dev server is meant for local development. For production, deploy the
  graph to LangSmith Deployment (or your own server) with a persistent checkpointer.
