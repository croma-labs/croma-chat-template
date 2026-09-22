import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createCromaToolbox, createToolSearch } from "@/lib/croma-tools";
import { instructions } from "@/lib/instructions";
import { resolveModel } from "@/lib/model";
import { clientIp, ratelimit } from "@/lib/ratelimit";

// E2E sample chat over Croma's public MCP server: every turn connects to the
// real MCP endpoint, lets the model find the tools it needs by keyword, and
// streams tool calls + markdown back to the UI.

export const maxDuration = 60;

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_PINNED_TOOLS = 16;

// Tool names the conversation already called, newest first.
function usedToolNames(messages: UIMessage[]): string[] {
  return [...messages].reverse().flatMap((message) =>
    [...message.parts].reverse().flatMap((part) => {
      if (part.type === "dynamic-tool") return [part.toolName];
      if (part.type.startsWith("tool-")) return [part.type.slice(5)];
      return [];
    }),
  );
}

export async function POST(req: Request) {
  if (ratelimit) {
    const { success, limit, remaining, reset } = await ratelimit.limit(
      clientIp(req),
    );
    if (!success) {
      return Response.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        },
      );
    }
  }

  const resolved = resolveModel();
  if (!resolved) {
    return Response.json({ error: "no_model_configured" }, { status: 503 });
  }

  let messages: UIMessage[];
  let pinnedNames: string[] = [];
  try {
    const body = (await req.json()) as {
      messages?: UIMessage[];
      tools?: unknown;
    };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new Error("missing messages");
    }
    messages = body.messages.slice(-MAX_MESSAGES);
    const oversized = messages.some((m) =>
      m.parts?.some(
        (p) => p.type === "text" && p.text.length > MAX_MESSAGE_CHARS,
      ),
    );
    if (oversized) {
      return Response.json({ error: "message_too_long" }, { status: 413 });
    }
    if (Array.isArray(body.tools)) {
      pinnedNames = body.tools
        .filter((t): t is string => typeof t === "string" && t.length <= 128)
        .slice(0, MAX_PINNED_TOOLS);
    }
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  // Fresh MCP client per request; if the server is unreachable the agent still
  // answers product questions, just without live-data tools.
  let toolbox: Awaited<ReturnType<typeof createCromaToolbox>> | undefined;
  try {
    toolbox = await createCromaToolbox();
  } catch (err) {
    console.error("[croma-chat] mcp connect failed", err);
  }

  // Pinned tools scope this message to the selected sources. The selection is
  // per-request — the client may add, switch, or clear tools between messages.
  // Unknown names are dropped; an empty result falls back to on-demand tool
  // search over the full toolbox.
  const pinned = pinnedNames.filter((name) => Boolean(toolbox?.tools[name]));
  const search =
    toolbox && pinned.length === 0
      ? createToolSearch(toolbox.tools, usedToolNames(messages))
      : undefined;
  const tools =
    toolbox && pinned.length > 0
      ? Object.fromEntries(pinned.map((name) => [name, toolbox.tools[name]]))
      : search?.tools;
  const pinnedNote =
    pinned.length > 0
      ? `\n\nPara esta consulta el usuario fijó ${
          pinned.length === 1
            ? `la fuente "${pinned[0]}"`
            : `las fuentes ${pinned.map((n) => `"${n}"`).join(", ")}`
        }: responde usando solo esas herramientas. Si la pregunta no encaja con ellas, dilo y sugiere ajustar el filtro de fuentes.`
      : "";

  const result = streamText({
    model: resolved.model,
    instructions: instructions({ search: Boolean(search) }) + pinnedNote,
    messages: await convertToModelMessages(messages),
    tools,
    prepareStep: search
      ? () => ({ activeTools: search.activeTools() })
      : undefined,
    stopWhen: stepCountIs(8),
    onEnd: () => toolbox?.close(),
    onAbort: () => toolbox?.close(),
    onError: ({ error }) => {
      console.error("[croma-chat] stream error", error);
      toolbox?.close();
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    // Generic client-facing message; the real error stays in the server log.
    onError: () => "agent_error",
  });
}
