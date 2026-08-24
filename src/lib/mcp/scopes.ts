export const GUD_MCP_READ_SCOPE = "gud:read";
export const GUD_MCP_WRITE_SCOPE = "gud:write";

export const GUD_MCP_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  GUD_MCP_READ_SCOPE,
  GUD_MCP_WRITE_SCOPE,
] as const;

export const GUD_MCP_DEFAULT_SCOPE = GUD_MCP_DEFAULT_SCOPES.join(" ");

export function requestedMcpScopes(rawScope?: string) {
  return rawScope?.split(/\s+/).filter(Boolean) ?? [...GUD_MCP_DEFAULT_SCOPES];
}
