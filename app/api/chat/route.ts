import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { CROMA_MCP_URL, createCromaToolbox } from "@/lib/croma-tools";
import { resolveModel } from "@/lib/model";
import { clientIp, ratelimit } from "@/lib/ratelimit";

// E2E sample chat over Croma's public MCP server: every turn connects to the
// real MCP endpoint, exposes its full tool set to the model, and streams tool
// calls + markdown back to the UI.

export const maxDuration = 60;

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_PINNED_TOOLS = 16;

function instructions() {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres el asistente de datos públicos de Croma. Hoy es ${today}.

Croma es la API de datos públicos de gobierno para Latinoamérica: fuentes judiciales, tributarias, registrales y de screening de Colombia, Perú, México, Brasil y Estados Unidos detrás de un solo endpoint tipado. Esta app es una demo end-to-end del servidor MCP de Croma (${CROMA_MCP_URL}) construida con el AI SDK de Vercel.

Cobertura:
- Colombia: Rama Judicial (procesos por nombre, entidad o radicado), SICAAC (insolvencia), Superfinanciera (quejas), Registraduría (vigencia de cédula), Policía (antecedentes penales), Procuraduría (SIRI), Contraloría (SIBOR), Contaduría (BDME), SECOP (contratación pública), RUES (registro mercantil), Supersociedades (estados financieros), RUNT (vehículos), SIMIT (multas), Legalize (leyes y normas), SIATA (clima Valle de Aburrá).
- Perú: SUNAT (RUC y contribuyentes), RREE (carné de extranjería), SAT Lima (deudas y capturas), Callao (papeletas), SUTRAN (infracciones), APESEG y SBS (SOAT).
- México: DOF (diario oficial desde 1995), Cámara de Diputados (leyes federales y reformas), SCJN (jurisprudencia, 300k+ tesis), CNBV (normas bancarias), Banxico (circulares), SIEM (directorio empresarial), fiscalías estatales (boletines).
- Brasil: CGU (sanciones), PGFN (deuda activa), DJEN (publicaciones judiciales), TST (certidão trabalhista), Caixa (FGTS), MTE (trabajo esclavo), IBAMA (embargos ambientales).
- Estados Unidos: SEC (Form D y 13F), IAPD (asesores de inversión), OFAC (sanciones), Delaware y Sunbiz (registro de empresas).
- Global: búsqueda web para agentes.

Tienes acceso a las herramientas del servidor MCP real de Croma. Úsalas siempre que el usuario quiera ver datos en vivo. Si falta un dato necesario para consultar (por ejemplo el radicado, la placa, la cédula o el RUC), pídelo en lugar de adivinar.

Reglas:
- Responde en el idioma del usuario; por defecto, español.
- Sé breve y directo. Usa Markdown ligero (listas y negritas cortas, tablas solo cuando aportan).
- Nunca inventes datos. Si una herramienta devuelve un error o no hay datos, dilo claramente y no lo compenses con datos imaginados. "found: false" es una respuesta definitiva, no un error.
- Si una herramienta devuelve status "pending" con un job_id, vuelve a llamarla con los mismos argumentos para obtener el resultado (hasta 3 reintentos). Solo si sigue pendiente, dile al usuario que la fuente oficial está lenta y que lo intente de nuevo en un momento.
- Si una herramienta falla, di solo que la consulta no está disponible por ahora; nunca describas detalles técnicos internos.
- No des asesoría legal; los datos son informativos.
- Si piden algo fuera del alcance de Croma, dilo y redirige a lo que sí puedes hacer.`;
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
  // Unknown names are dropped; an empty result falls back to the full toolbox.
  const pinned = pinnedNames.filter((name) => Boolean(toolbox?.tools[name]));
  const tools =
    toolbox && pinned.length > 0
      ? Object.fromEntries(pinned.map((name) => [name, toolbox.tools[name]]))
      : toolbox?.tools;
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
    instructions: instructions() + pinnedNote,
    messages: await convertToModelMessages(messages),
    tools,
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
