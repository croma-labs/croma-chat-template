import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { jsonSchema, tool, type ToolSet } from "ai";
import { z } from "zod";
import { SEARCH_TOOL } from "@/lib/sources";

// Toolbox over Croma's public MCP server. Contract: real data or an honest
// generic error — upstream failure details go to the server log, never to the
// model or the user.

const GENERIC_ERROR = "La consulta no está disponible en este momento.";
const MAX_RESULT_CHARS = 6_000;

export const CROMA_MCP_URL =
  process.env.CROMA_MCP_URL ?? "https://api.croma.run/mcp";

// Cap result text so one broad query can't blow up the model context.
function trimResult(result: unknown): unknown {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const { content, ...rest } = result as { content: unknown[] };
    return {
      ...rest,
      content: content.map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          const text = (part as { text: string }).text;
          return text.length > MAX_RESULT_CHARS
            ? {
                ...part,
                text: `${text.slice(0, MAX_RESULT_CHARS)}… [resultado truncado]`,
              }
            : part;
        }
        return part;
      }),
    };
  }
  return result;
}

// gpt-oss on Groq fills optional tool params with null, and Groq validates
// arguments against the schema and rejects the call ("expected number, got
// null"). Loosen every optional property to also accept null, whether it
// declares a plain `type` or a union (`anyOf`/`oneOf`, e.g. a `year` that is
// 0 or a range); the execute wrapper strips the nulls before they reach the
// MCP server. Harmless for providers that don't do this (e.g. Anthropic).
export function nullableOptionals(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  const out = { ...(schema as Record<string, unknown>) };
  if (out.properties && typeof out.properties === "object") {
    const required = new Set(
      Array.isArray(out.required) ? (out.required as string[]) : [],
    );
    out.properties = Object.fromEntries(
      Object.entries(out.properties as Record<string, unknown>).map(
        ([key, prop]) => {
          let next = nullableOptionals(prop) as Record<string, unknown>;
          if (!required.has(key) && next && typeof next === "object") {
            next = acceptNull(next);
          }
          return [key, next];
        },
      ),
    );
  }
  if (out.items) out.items = nullableOptionals(out.items);
  return out;
}

function acceptNull(prop: Record<string, unknown>): Record<string, unknown> {
  if (typeof prop.type === "string") {
    return prop.type === "null" ? prop : { ...prop, type: [prop.type, "null"] };
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = prop[key];
    if (Array.isArray(branches)) {
      const hasNull = branches.some(
        (branch) => (branch as { type?: unknown } | null)?.type === "null",
      );
      return hasNull ? prop : { ...prop, [key]: [...branches, { type: "null" }] };
    }
  }
  return prop;
}

function stripNulls(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([, value]) => value !== null,
    ),
  );
}

export async function createCromaToolbox() {
  const apiKey = process.env.CROMA_API_KEY;
  if (!apiKey) {
    throw new Error("CROMA_API_KEY is not set");
  }

  const client: MCPClient = await createMCPClient({
    transport: {
      type: "http",
      url: CROMA_MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    clientName: "croma-ai-sdk-sample",
  });

  const available = await client.tools();
  const tools = Object.fromEntries(
    Object.entries(available).map(([name, mcpTool]) => {
      const rawSchema = (mcpTool as { inputSchema?: { jsonSchema?: unknown } })
        .inputSchema?.jsonSchema;
      return [
        name,
        {
          ...mcpTool,
          ...(rawSchema
            ? {
                inputSchema: jsonSchema(
                  nullableOptionals(rawSchema) as Parameters<
                    typeof jsonSchema
                  >[0],
                ),
              }
            : {}),
          execute: async (input: unknown, options: unknown) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const output = await (mcpTool.execute as any)(
                stripNulls(input),
                options,
              );
              return trimResult(output);
            } catch (err) {
              console.error(`[croma-chat] mcp tool ${name} failed`, err);
              return { error: GENERIC_ERROR };
            }
          },
        },
      ];
    }),
  ) as ToolSet;

  return {
    tools,
    close: () => void client.close().catch(() => undefined),
  };
}

// Groq rejects requests with more than 128 tools, and the full Croma catalog
// is larger than that (and ~30k tokens of schemas). Chats therefore start with
// the search tool and the monitor tools; the model finds the rest by keyword
// and prepareStep sends only what is active to the provider.
const MAX_ACTIVE_TOOLS = 48;
const SEARCH_LIMIT = 8;

// Always on: a request to be alerted names the subject ("the ANM", a NIT),
// not the tool, so a search for the subject never surfaces create_monitor.
export const ALWAYS_ON = ["create_monitor", "list_monitors"];

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function describe(tool: ToolSet[string]): string {
  return typeof tool.description === "string" ? tool.description : "";
}

// The searches create_monitor can watch, as its own description lists them.
export function monitorableSearches(tools: ToolSet): Set<string> {
  const listed = describe(tools.create_monitor ?? ({} as ToolSet[string]))
    .match(/Searches that can be monitored: ([^.]+)\./)?.[1];
  return new Set((listed ?? "").split(",").map((name) => name.trim()).filter(Boolean));
}

// Keywords or a regular expression over each tool's name and description,
// accents and case ignored. A term in the name counts three times one in the
// description; a regex that matches adds three.
export function searchTools(
  tools: ToolSet,
  query: string,
  limit = SEARCH_LIMIT,
): string[] {
  const folded = fold(query);
  let pattern: RegExp | null = null;
  try {
    pattern = new RegExp(folded, "i");
  } catch {
    pattern = null;
  }
  const terms = folded.split(/[\s|,]+/).filter((term) => term.length > 2);
  return Object.entries(tools)
    .filter(([name]) => name !== SEARCH_TOOL && !ALWAYS_ON.includes(name))
    .map(([name, t]) => {
      const title = fold(name.replaceAll("_", " "));
      const text = `${title} ${fold(describe(t))}`;
      let score = pattern?.test(text) ? 3 : 0;
      for (const term of terms) {
        if (title.includes(term)) score += 3;
        else if (text.includes(term)) score += 1;
      }
      return { name, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ name }) => name);
}

// `preload` lists tool names the conversation already used (newest first), so
// follow-up questions keep working without searching again.
export function createToolSearch(tools: ToolSet, preload: Iterable<string> = []) {
  const monitorable = monitorableSearches(tools);
  const active = new Set<string>(ALWAYS_ON.filter((name) => name in tools));
  for (const name of preload) {
    if (name in tools && name !== SEARCH_TOOL && active.size < MAX_ACTIVE_TOOLS) {
      active.add(name);
    }
  }

  const buscarHerramientas = tool({
    description:
      "Search Croma's tools by keywords or a regular expression over their names and descriptions, which are in English (e.g. \"SUNAT RUC\", \"traffic fines plate\", \"court rulings\"). Returns up to eight tools; they become available on the next step, so wait for them before calling. Tools marked monitorable can be watched with create_monitor. If nothing fits, try other keywords.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Keywords or a regular expression"),
    }),
    execute: async ({ query }) => {
      const found = searchTools(tools, query);
      const loaded: string[] = [];
      for (const name of found) {
        if (active.has(name) || active.size < MAX_ACTIVE_TOOLS) {
          active.add(name);
          loaded.push(name);
        }
      }
      return {
        tools: loaded.map((name) => ({
          name,
          description: describe(tools[name]!).slice(0, 240),
          ...(monitorable.has(name) ? { monitorable: true } : {}),
        })),
        ...(loaded.length < found.length
          ? { note: "Active tool limit reached; answer with the tools already active." }
          : {}),
      };
    },
  });

  return {
    tools: { ...tools, [SEARCH_TOOL]: buscarHerramientas } as ToolSet,
    activeTools: () => [SEARCH_TOOL, ...active],
  };
}
