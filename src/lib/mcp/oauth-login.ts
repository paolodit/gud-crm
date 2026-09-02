const REQUIRED_AUTHORIZATION_PARAMETERS = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
] as const;

export function requireMcpConsentPrompt(
  path: string,
  query: Record<string, unknown> | undefined,
) {
  if (path !== "/mcp/authorize") return query;
  const prompt = typeof query?.prompt === "string" ? query.prompt : "";
  const prompts = new Set(prompt.split(/\s+/).filter(Boolean));
  prompts.add("consent");
  return { ...query, prompt: [...prompts].join(" ") };
}

export function getMcpAuthorizationResumeUrl(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
    return null;
  }
  if (REQUIRED_AUTHORIZATION_PARAMETERS.some((name) => !params.get(name))) return null;

  return `/api/auth/mcp/authorize?${params.toString()}`;
}
