<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/croma_brand_white.svg">
  <img alt="Croma" src="public/croma_brand_black.svg" height="26">
</picture>

# Croma Chat Template

**A production-ready AI chat over live Latin American public data.**

Streaming chat built with the [Vercel AI SDK](https://ai-sdk.dev) and [AI Elements](https://ai-sdk.dev/elements), connected to the [Croma MCP server](https://platform.usecroma.com/mcp): judicial, tax, and registry sources from Colombia, Peru, and Mexico, queried in real time.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=croma-chat-template&repository-name=croma-chat-template&repository-url=https%3A%2F%2Fgithub.com%2Fcroma-ai%2Fcroma-chat-template&env=CROMA_API_KEY,GROQ_API_KEY&envDescription=CROMA_API_KEY+powers+the+live-data+tools+%28free+to+get%29.+GROQ_API_KEY+runs+the+model%2C+or+set+ANTHROPIC_API_KEY+after+deploy+to+use+Claude.&envLink=https%3A%2F%2Fplatform.usecroma.com%2Fsign-up)
&nbsp;
[![Get your Croma API key](public/croma-api-key-badge.svg)](https://platform.usecroma.com/sign-up)

</div>

---

## What's inside

- **Live MCP tools**: every request opens a client against `https://api.croma.run/mcp` with the full Croma catalog (200+ tools from 70+ sources: Rama Judicial, SUNAT, RUES, SECOP, DOF, SCJN, SIATA, and more).
- **Tool search**: the model starts with one `buscar_herramientas` tool and finds the tools it needs by keyword or regex over their names and descriptions (in-process, ~1 ms). Only what it finds is sent to the provider, which keeps Groq under its 128-tool limit and the prompt small.
- **Monitors from chat**: *"Avísame cuando haya contratos nuevos de Ecopetrol en el SECOP"* creates a Croma monitor, a saved search that emails what is new after each refresh of the source. `create_monitor` and `list_monitors` are always loaded; the agent finds the source's search, asks for the recipient emails, and never invents them.
- **Streaming everything**: text, reasoning, and tool calls stream token-by-token via AI SDK v7's UI message stream.
- **World-class chat UI**: [AI Elements](https://ai-sdk.dev/elements) components on a swiss, ruled-sheet design system: hairline grid rails, mono eyebrow labels, square surfaces, inverted selection, conversation with stick-to-bottom scrolling, markdown responses (Streamdown), collapsible tool cards with friendly source labels, reasoning disclosure, stop/regenerate, dark mode.
- **Optional tool pinning**: a docs-style picker in the composer (country → category → source, searchable) pins one or more MCP tools. The selection applies per message: add, switch, or clear sources mid-conversation and the next question uses the new scope. The catalog is fetched live from the server and cached.
- **Claude-first model resolution**: runs on `claude-opus-5` when `ANTHROPIC_API_KEY` is set, and falls back to Groq's `openai/gpt-oss-120b` otherwise. Swap models in one file.
- **Optional rate limiting**: add two Upstash env vars and `/api/chat` is limited to 10 requests per minute per IP. Without them, the limiter is a no-op.
- **Honest data handling**: results are truncated before they blow up context, tool failures return a generic message (details stay in server logs), and Croma's async "pending job" lookups are automatically re-polled.
- **Groq-proof tool calls**: optional fields accept `null` (including `anyOf` unions), and when Groq rejects a tool call against its schema the step is retried once with the rejection spelled out instead of failing the turn.

## One-click deploy

1. Click **Deploy with Vercel** above.
2. Grab a free API key with the **Get your Croma API key** button (sign-up takes a minute).
3. Paste your `CROMA_API_KEY` and `GROQ_API_KEY` (from [console.groq.com](https://console.groq.com/keys)) when Vercel asks for env vars.
4. Done. Your chat is live.

Prefer Claude? Add `ANTHROPIC_API_KEY` in your Vercel project settings and the template switches to `claude-opus-5` automatically on the next deploy.

## Running locally

```bash
git clone https://github.com/croma-ai/croma-chat-template
cd croma-chat-template
bun install          # or: pnpm install / npm install

cp .env.example .env.local
# fill in CROMA_API_KEY and GROQ_API_KEY (or ANTHROPIC_API_KEY)

bun dev              # or: pnpm dev / npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and try one of the suggestion chips: *"Consulta el RUC 20100047218 en SUNAT"* runs a real lookup against the Peruvian tax authority.

## Environment variables

| Variable                   | Required | Description                                                                                |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `CROMA_API_KEY`            | ✅       | Authenticates the MCP tools. [Get one free →](https://platform.usecroma.com/sign-up)       |
| `GROQ_API_KEY`             | ✅\*     | Runs `openai/gpt-oss-120b` on [Groq](https://console.groq.com/keys).                       |
| `ANTHROPIC_API_KEY`        | ✅\*     | Runs `claude-opus-5`. Takes precedence over Groq when both are set.                        |
| `CROMA_MCP_URL`            | optional | MCP endpoint override. Defaults to `https://api.croma.run/mcp`.                            |
| `UPSTASH_REDIS_REST_URL`   | optional | Enables rate limiting on `/api/chat`. [Upstash Console →](https://console.upstash.com/)    |
| `UPSTASH_REDIS_REST_TOKEN` | optional | Pairs with the URL above.                                                                  |

\* One model key is required: Anthropic **or** Groq.

## How it works

```
app/api/chat/route.ts        streamText + system prompt + UI message stream (+ optional pinned tools)
app/api/tools/route.ts       Tool catalog for the picker (MCP listTools, cached in-memory)
components/chat/chat.tsx     Chat orchestrator (useChat, composer, transcript)
components/chat/…            Header, empty state, message parts, tool picker
lib/croma-tools.ts           MCP client (auth, null-tolerant schemas, truncation, error shielding) + tool search
lib/instructions.ts          System prompt: coverage, monitor recipe, tool search
lib/model.ts                 Model resolution (Claude first, Groq fallback)
lib/tool-call-retry.ts       Middleware: retry a step once when the provider rejects a tool call
scripts/eval-tools.ts        Wiring check: right tool and right create_monitor arguments, nothing executed
lib/ratelimit.ts             Optional Upstash rate limiter (active when env vars are set)
lib/sources.ts               Source taxonomy (country → category → source, mirrors the docs)
```

Each `POST /api/chat`:

1. Opens a fresh MCP client over streamable HTTP with `Authorization: Bearer $CROMA_API_KEY`.
2. Discovers the server's tools and hands them to `streamText` with `buscar_herramientas`, `create_monitor` and `list_monitors` active; `prepareStep` adds each tool the model finds, plus the tools the conversation already used (`stopWhen: stepCountIs(8)` allows multi-step tool use, including re-polling Croma's async jobs).
3. Streams UI message chunks (text, reasoning, tool input/output) back to the client and closes the MCP client when the stream ends, aborts, or errors.

If the MCP server is unreachable, the chat degrades gracefully: the model still answers, just without live-data tools.

## Customization

- **Model**: edit `lib/model.ts`. Any [AI SDK provider](https://ai-sdk.dev/providers/ai-sdk-providers) works.
- **System prompt**: `instructions()` in `lib/instructions.ts`. Coverage list, tone, language, the monitor recipe and the pending-job retry policy live here.
- **Checking the wiring**: `bun run eval:tools` (or `bun scripts/eval-tools.ts 3` for three rounds) asks 22 questions against the live catalog and checks that the model picks the right tool, asks for an email before creating a monitor, and calls `create_monitor` with a monitorable search and that search's own fields. Nothing is executed, so it creates nothing and spends no credits.
- **Suggestions & source taxonomy**: `SUGGESTIONS` and the country/category maps in `lib/sources.ts`.
- **Rate limits**: algorithm and window in `lib/ratelimit.ts`.
- **Look & feel**: design tokens in `app/globals.css` (`--line` hairlines, `--agent` accent, square radius; shadcn/Tailwind v4); components in `components/chat/` and `components/ai-elements/`.

## Production notes

- `maxDuration = 60` on the chat route covers multi-step tool chains on Vercel.
- Requests are capped at 24 messages / 4,000 chars per message before they reach the model.
- Rate limiting ships built in: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` and `/api/chat` returns 429 (with `X-RateLimit-*` headers) past 10 requests per minute per IP, on a sliding window.
- For a public deployment, consider adding bot protection ([Vercel BotID](https://vercel.com/docs/botid)) on `/api/chat`.

## Learn more

- [Croma docs](https://docs.usecroma.com): every endpoint, with schemas
- [Croma MCP](https://platform.usecroma.com/mcp): connect the same server to Claude, ChatGPT, or Cursor
- [AI SDK docs](https://ai-sdk.dev/docs) · [AI Elements](https://ai-sdk.dev/elements)

## License

[MIT](LICENSE)
