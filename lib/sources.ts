// Taxonomy for Croma MCP tools. Source and country come from each tool's
// description, which ends with "(Source: SUNAT; Country: Peru)", so new tools
// group correctly without code changes. Only display niceties are curated
// here: Spanish country names and the docs categories. Shared by server and
// client, so it must stay free of server-only imports.

export type CatalogTool = {
  name: string;
  title: string;
  description: string;
  source: string;
  country: string;
};

// Meta-tool the chat route adds to activate sources on demand.
export const SOURCE_TOOL = "activar_fuentes";

export function parseSource(description: string): {
  source?: string;
  country?: string;
} {
  const match = description.match(/\(Source: ([^;]+); Country: ([^.)]+)/);
  return { source: match?.[1]?.trim(), country: match?.[2]?.trim() };
}

type CountryMeta = { label: string; short: string; flag: string };

// Keyed by the English country name the MCP descriptions use; also the tab
// order. Countries not listed here show their raw name after these.
const COUNTRY_META: Record<string, CountryMeta> = {
  Colombia: { label: "Colombia", short: "CO", flag: "🇨🇴" },
  Peru: { label: "Perú", short: "PE", flag: "🇵🇪" },
  Mexico: { label: "México", short: "MX", flag: "🇲🇽" },
  Brazil: { label: "Brasil", short: "BR", flag: "🇧🇷" },
  "United States": { label: "Estados Unidos", short: "US", flag: "🇺🇸" },
  Global: { label: "Global", short: "Global", flag: "🌐" },
};

export function countryMeta(country: string): CountryMeta {
  return COUNTRY_META[country] ?? { label: country, short: country, flag: "🌐" };
}

// Curated countries first, then new ones alphabetically, Global last.
export function countriesOf(tools: CatalogTool[]): string[] {
  const present = new Set(tools.map((t) => t.country));
  const known = Object.keys(COUNTRY_META).filter((c) => c !== "Global");
  return [
    ...known.filter((c) => present.has(c)),
    ...[...present]
      .filter((c) => !(c in COUNTRY_META))
      .sort((a, b) => a.localeCompare(b)),
    ...(present.has("Global") ? ["Global"] : []),
  ];
}

// Category by tool-name prefix (`rama_judicial_cases_by_radicado` → `rama`).
// Sources missing here land in "Otros".
const CATEGORIES: Record<string, string> = {
  // Colombia
  rama: "Justicia y litigios",
  samai: "Justicia y litigios",
  consejo: "Justicia y litigios",
  cndj: "Justicia y litigios",
  superfinanciera: "Justicia y litigios",
  registraduria: "Verificación de personas",
  registro: "Verificación de personas",
  policia: "Verificación de personas",
  procuraduria: "Verificación de personas",
  contraloria: "Verificación de personas",
  contaduria: "Verificación de personas",
  adres: "Verificación de personas",
  ruaf: "Verificación de personas",
  sicaac: "Verificación de personas",
  rues: "Empresas e impuestos",
  supersociedades: "Empresas e impuestos",
  dian: "Empresas e impuestos",
  secop: "Contratación pública",
  ancp: "Contratación pública",
  runt: "Vehículos y tránsito",
  simit: "Vehículos y tránsito",
  // Perú
  sunat: "Identidad e impuestos",
  rree: "Identidad e impuestos",
  sat: "Identidad e impuestos",
  callao: "Vehículos y tránsito",
  sutran: "Vehículos y tránsito",
  apeseg: "Vehículos y tránsito",
  sbs: "Vehículos y tránsito",
  oece: "Contratación pública",
  // México
  dof: "Leyes y regulación",
  diputados: "Leyes y regulación",
  cnbv: "Leyes y regulación",
  banxico: "Leyes y regulación",
  cnsf: "Leyes y regulación",
  scjn: "Justicia y fiscalías",
  fiscalia: "Justicia y fiscalías",
  // Brasil
  djen: "Justicia",
  cgu: "Sanciones y listas",
  ibama: "Sanciones y listas",
  mte: "Sanciones y listas",
  pgfn: "Deudas y certificados",
  tst: "Deudas y certificados",
  caixa: "Deudas y certificados",
  // Estados Unidos
  delaware: "Registro de empresas",
  sunbiz: "Registro de empresas",
  sec: "Mercado de valores",
  iapd: "Mercado de valores",
  ofac: "Sanciones",
  // Global
  web: "Agentes",
  extract: "Agentes",
  generate: "Agentes",
  research: "Agentes",
};

// Tools whose category differs from their source's default (docs place
// SAT Lima capturas under vehicles, account status under identity).
const TOOL_CATEGORY_OVERRIDES: Record<string, string> = {
  sat_lima_capturas: "Vehículos y tránsito",
};

export function categoryOf(toolName: string): string {
  return (
    TOOL_CATEGORY_OVERRIDES[toolName] ??
    CATEGORIES[toolName.split("_")[0] ?? ""] ??
    "Otros"
  );
}

export function toolTitle(toolName: string, source?: string): string {
  const label = toolName === SOURCE_TOOL ? "Croma" : source;
  return label ? `${label} · ${toolName}` : toolName;
}

export const SUGGESTIONS = [
  "¿Qué publicó hoy el DOF en México?",
  "Consulta el RUC 20100047218 en SUNAT",
  "Busca a Ecopetrol en el registro mercantil (RUES)",
  "¿Cómo está el clima ahora en el Valle de Aburrá?",
  "Jurisprudencia de la SCJN sobre pensión alimenticia",
  "Boletines recientes de la Fiscalía de Jalisco",
];
