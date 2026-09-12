import { createMCPClient } from "@ai-sdk/mcp";
import { CROMA_MCP_URL } from "@/lib/croma-tools";
import { type CatalogTool, parseSource } from "@/lib/sources";

// Catalog of the MCP server's tools for the composer's tool picker.
// Cached in-memory: the catalog changes rarely and the MCP handshake is the
// expensive part of this route.

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { tools: CatalogTool[]; expiresAt: number } | undefined;

async function fetchCatalog(): Promise<CatalogTool[]> {
  const apiKey = process.env.CROMA_API_KEY;
  if (!apiKey) throw new Error("CROMA_API_KEY is not set");

  const client = await createMCPClient({
    transport: {
      type: "http",
      url: CROMA_MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    clientName: "croma-chat-template",
  });

  try {
    const { tools } = await client.listTools();
    return tools
      .map((tool) => {
        const description = tool.description ?? "";
        const { source, country } = parseSource(description);
        return {
          name: tool.name,
          title: tool.title ?? tool.name,
          description,
          source: source ?? tool.name.split("_")[0] ?? tool.name,
          country: country ?? "Global",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    void client.close().catch(() => undefined);
  }
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return Response.json({ tools: cache.tools });
  }
  try {
    const tools = await fetchCatalog();
    cache = { tools, expiresAt: Date.now() + CACHE_TTL_MS };
    return Response.json({ tools });
  } catch (err) {
    console.error("[croma-chat] tool catalog failed", err);
    // Serve a stale catalog over an error if we have one.
    if (cache) return Response.json({ tools: cache.tools });
    return Response.json({ tools: [] }, { status: 503 });
  }
}
