// Checks the MCP wiring end to end against the live catalog: for each question,
// does the model find the right Croma tool and call it with sensible
// arguments, and does "avísame cuando…" become a correct create_monitor call?
// Uses the same model, instructions and tool search as /api/chat, but no Croma
// tool executes: the first real call is captured and checked, so nothing is
// looked up, created or billed.
//
//   bun scripts/eval-tools.ts            # one round
//   bun scripts/eval-tools.ts 3          # three rounds
//
// Needs CROMA_API_KEY and GROQ_API_KEY (or ANTHROPIC_API_KEY) in .env.local.

import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import {
  createCromaToolbox,
  createToolSearch,
  monitorableSearches,
} from "@/lib/croma-tools";
import { instructions } from "@/lib/instructions";
import { resolveModel } from "@/lib/model";
import { SEARCH_TOOL } from "@/lib/sources";

type Monitor = {
  endpoint: string;
  query?: Record<string, unknown>;
  recipients?: string[];
  schedule?: Record<string, unknown>;
};
type Expect =
  | { kind: "lookup"; prefixes: string[] }
  | { kind: "ask-email" }
  | { kind: "refuse" }
  | {
      kind: "monitor";
      endpoint: string;
      query: Record<string, string>;
      recipients: string[];
      schedule?: Record<string, string>;
    };
type Case = { label: string; messages: ModelMessage[]; expect: Expect };

const user = (content: string): ModelMessage[] => [{ role: "user", content }];
const lookup = (question: string, ...prefixes: string[]): Case => ({
  label: question,
  messages: user(question),
  expect: { kind: "lookup", prefixes },
});

const CASES: Case[] = [
  lookup("Consulta el RUC 20100047218 en SUNAT", "sunat"),
  lookup("¿Qué procesos judiciales tiene la empresa Construcciones Andinas S.A.S.?", "rama"),
  lookup("Busca el proceso con radicado 11001310300120230012300", "rama"),
  lookup("¿La placa ABC123 tiene multas de tránsito en Colombia?", "simit"),
  lookup("Dame el historial del vehículo de placa ABC123", "runt"),
  lookup("¿El NIT 900123456 tiene contratos con el Estado colombiano?", "secop"),
  lookup("Verifica si Juan Pérez Gómez aparece en la lista OFAC", "ofac", "csl"),
  lookup("Estados financieros de la sociedad con NIT 860002964", "supersociedades"),
  lookup("Tesis de la Suprema Corte de México sobre prisión preventiva oficiosa", "scjn"),
  lookup("Circulares recientes del Banco de México", "banxico"),
  lookup("¿La cédula 1234567890 tiene antecedentes penales?", "policia"),
  lookup("Deudas en la PGFN del CNPJ 00.000.000/0001-91", "pgfn"),
  lookup("¿Qué dice la doctrina de la DIAN sobre retención en la fuente?", "dian"),
  lookup("Busca empresas en Delaware llamadas Acme Holdings", "delaware"),
  lookup("¿Tiene SOAT vigente la placa ABC123 en Perú?", "apeseg", "sbs"),
  lookup("¿Cómo está la calidad del aire en Medellín hoy?", "siata"),
  lookup("Sentencias de la Corte Constitucional sobre hábeas data", "corte"),
  {
    label: "monitor without an email asks for one",
    messages: user("Avísame cuando la ANM publique algo sobre el título AD9-111"),
    expect: { kind: "ask-email" },
  },
  {
    label: "monitor with the email in a follow-up",
    messages: [
      { role: "user", content: "Avísame cuando la ANM publique algo sobre el título AD9-111" },
      { role: "assistant", content: "Claro. ¿A qué correo te envío los avisos?" },
      { role: "user", content: "a legal@banco.com" },
    ],
    expect: {
      kind: "monitor",
      endpoint: "anm_notices_search",
      query: { title_number: "AD9-111" },
      recipients: ["legal@banco.com"],
    },
  },
  {
    label: "monitor on a contractor's contracts",
    messages: user(
      "Monitorea los contratos nuevos del proveedor con NIT 900123456 en SECOP y avísame a compras@empresa.com",
    ),
    expect: {
      kind: "monitor",
      endpoint: "secop_contracts_search",
      query: { provider_document: "900123456" },
      recipients: ["compras@empresa.com"],
    },
  },
  {
    label: "weekly monitor on a topic",
    messages: user(
      "Quiero una alerta semanal, los lunes, de sentencias nuevas de la Corte Constitucional sobre hábeas data; envíala a legal@banco.com",
    ),
    expect: {
      kind: "monitor",
      endpoint: "corte_constitucional_rulings_search",
      query: { query: "data" },
      recipients: ["legal@banco.com"],
      schedule: { cadence: "weekly", weekday: "monday" },
    },
  },
  {
    label: "monitor on a source that cannot be monitored",
    messages: user("Avísame a legal@banco.com cuando Banxico publique una circular nueva"),
    expect: { kind: "refuse" },
  },
];

type Outcome = { tool: string | null; input: unknown; text: string; ms: number };

// "/co/anm/notices-search/v1" and "anm-notices-search" both mean anm_notices_search.
function toolNameOf(endpoint: unknown): string {
  return String(endpoint ?? "")
    .trim()
    .replace(/^\/?[a-z]{2}\//, "")
    .replace(/\/v\d+$/, "")
    .replaceAll("/", "_")
    .replaceAll("-", "_");
}

function propertiesOf(tool: ToolSet[string] | undefined): string[] {
  const schema = (tool?.inputSchema as { jsonSchema?: { properties?: object } } | undefined)?.jsonSchema;
  return Object.keys(schema?.properties ?? {});
}

function problemWith(outcome: Outcome, expect: Expect, tools: ToolSet, monitorable: Set<string>): string | null {
  switch (expect.kind) {
    case "lookup":
      return outcome.tool && expect.prefixes.includes(outcome.tool.split("_")[0]!)
        ? null
        : `called ${outcome.tool ?? "nothing"}${outcome.tool ? "" : `: ${outcome.text.slice(0, 100)}`}`;
    case "ask-email":
      if (outcome.tool === "create_monitor") return `created without asking: ${JSON.stringify(outcome.input)}`;
      return /correo|email|e-mail/i.test(outcome.text) ? null : `did not ask for an email: ${outcome.text.slice(0, 100)}`;
    case "refuse":
      return outcome.tool === "create_monitor" ? `created it anyway: ${JSON.stringify(outcome.input)}` : null;
    case "monitor": {
      if (outcome.tool !== "create_monitor") return `called ${outcome.tool ?? "nothing"} instead of create_monitor: ${outcome.text.slice(0, 100)}`;
      const input = outcome.input as Monitor;
      const endpoint = toolNameOf(input.endpoint);
      if (!monitorable.has(endpoint)) return `endpoint ${input.endpoint} cannot be monitored`;
      if (endpoint !== expect.endpoint) return `endpoint ${endpoint}, want ${expect.endpoint}`;
      const fields = propertiesOf(tools[endpoint]);
      for (const key of Object.keys(input.query ?? {})) {
        if (key === "page" || key === "per_page") return `query carries ${key}`;
        if (!fields.includes(key)) return `query.${key} is not a field of ${endpoint}`;
      }
      for (const [key, value] of Object.entries(expect.query)) {
        if (!String(input.query?.[key] ?? "").toLowerCase().includes(value.toLowerCase())) {
          return `query.${key} is ${JSON.stringify(input.query?.[key])}, want ${value}`;
        }
      }
      const got = [...(input.recipients ?? [])].map((email) => email.toLowerCase()).sort().join(", ");
      if (got !== [...expect.recipients].sort().join(", ")) return `recipients ${got || "none"}`;
      for (const [key, value] of Object.entries(expect.schedule ?? {})) {
        const actual = input.schedule?.[key] ?? (key === "weekday" ? "monday" : undefined);
        if (actual !== value) return `schedule.${key} is ${String(actual)}, want ${value}`;
      }
      return null;
    }
  }
}

async function main() {
  const rounds = Number(process.argv[2] ?? 1);
  const resolved = resolveModel();
  if (!resolved) throw new Error("Set GROQ_API_KEY or ANTHROPIC_API_KEY");
  const toolbox = await createCromaToolbox();
  // No execute: the loop stops at the first real call, which is what we check.
  const captured = Object.fromEntries(
    Object.entries(toolbox.tools).map(([name, t]) => [name, { ...t, execute: undefined }]),
  ) as ToolSet;
  const monitorable = monitorableSearches(captured);
  console.log(`${resolved.id} · ${Object.keys(captured).length} tools · ${rounds} round(s)\n`);

  let passed = 0;
  let crashed = 0;
  const times: number[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const test of CASES) {
      const search = createToolSearch(captured);
      const started = Date.now();
      try {
        const result = await generateText({
          model: resolved.model,
          instructions: instructions({ search: true }),
          messages: test.messages,
          tools: search.tools,
          prepareStep: () => ({ activeTools: search.activeTools() }),
          stopWhen: stepCountIs(8),
        });
        const call = result.steps.flatMap((step) => step.toolCalls).find((c) => c.toolName !== SEARCH_TOOL);
        const outcome: Outcome = { tool: call?.toolName ?? null, input: call?.input, text: result.text, ms: Date.now() - started };
        times.push(outcome.ms);
        const problem = problemWith(outcome, test.expect, captured, monitorable);
        if (!problem) passed++;
        console.log(`${problem ? "✗" : "✓"} ${test.label} (${outcome.ms} ms)${problem ? `\n    ${problem}` : ""}`);
      } catch (err) {
        crashed++;
        console.log(`✗ ${test.label}\n    crashed: ${String(err).slice(0, 200)}`);
      }
    }
  }
  toolbox.close();
  times.sort((a, b) => a - b);
  const total = CASES.length * rounds;
  console.log(
    `\n${passed}/${total} passed, ${crashed} crashed · p50 ${times[Math.floor(times.length / 2)] ?? "-"} ms · p90 ${times[Math.floor(times.length * 0.9)] ?? "-"} ms`,
  );
  process.exit(crashed > 0 ? 1 : 0);
}

void main();
