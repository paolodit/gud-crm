export const GUD_MCP_TOOL_NAMES = [
  "describe_workspace",
  "get_sales_brief",
  "list_opportunities",
  "get_opportunity",
  "search_companies",
  "submit_research_results",
  "create_opportunity",
  "update_company",
  "save_contact",
  "update_opportunity",
  "set_next_action",
  "complete_task",
  "log_activity",
  "archive_opportunity",
  "restore_opportunity",
  "archive_company",
  "restore_company",
  "find_work_email",
  "get_opportunities",
  "list_live_projects",
  "update_live_project",
] as const;

const GUD_MCP_TOOL_NAME_SET = new Set<string>(GUD_MCP_TOOL_NAMES);
const COMPATIBLE_TOOL_PREFIXES = ["gud.", "gud_crm.", "gud_crm_"] as const;

export function normaliseGudMcpToolName(name: string) {
  if (GUD_MCP_TOOL_NAME_SET.has(name)) return name;
  for (const prefix of COMPATIBLE_TOOL_PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    const canonicalName = name.slice(prefix.length);
    if (GUD_MCP_TOOL_NAME_SET.has(canonicalName)) return canonicalName;
  }
  return name;
}

export function normaliseGudMcpPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    const normalised = payload.map(normaliseGudMcpPayload);
    return normalised.some((entry, index) => entry !== payload[index]) ? normalised : payload;
  }
  if (!isRecord(payload) || payload.method !== "tools/call" || !isRecord(payload.params)) return payload;
  if (typeof payload.params.name !== "string") return payload;
  const canonicalName = normaliseGudMcpToolName(payload.params.name);
  if (canonicalName === payload.params.name) return payload;
  return { ...payload, params: { ...payload.params, name: canonicalName } };
}

export async function normaliseGudMcpRequest(request: Request) {
  if (request.method !== "POST" || !request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return request;
  }
  let payload: unknown;
  try {
    payload = await request.clone().json();
  } catch {
    return request;
  }
  const normalisedPayload = normaliseGudMcpPayload(payload);
  if (normalisedPayload === payload) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(normalisedPayload),
    signal: request.signal,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
