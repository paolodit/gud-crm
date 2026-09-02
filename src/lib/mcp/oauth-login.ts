const REQUIRED_AUTHORIZATION_PARAMETERS = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
] as const;

export function getMcpAuthorizationResumeUrl(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") {
    return null;
  }
  if (REQUIRED_AUTHORIZATION_PARAMETERS.some((name) => !params.get(name))) return null;

  return `/api/auth/mcp/authorize?${params.toString()}`;
}
