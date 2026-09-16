export const GUD_MCP_READ_SCOPE = "gud:read";
export const GUD_MCP_WRITE_SCOPE = "gud:write";
export const THOUGHTS_READ_SCOPE = "gud:thoughts:read";
export const THOUGHTS_WRITE_SCOPE = "gud:thoughts:write";

export const GUD_MCP_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  GUD_MCP_READ_SCOPE,
  GUD_MCP_WRITE_SCOPE,
] as const;

export const GUD_MCP_DEFAULT_SCOPE = GUD_MCP_DEFAULT_SCOPES.join(" ");
// Personal data is never granted by an ordinary sales connection.
export const GUD_MCP_SUPPORTED_SCOPES = [...GUD_MCP_DEFAULT_SCOPES, THOUGHTS_READ_SCOPE, THOUGHTS_WRITE_SCOPE];
export function consentedMcpScopes(tokenScopes: string[], grants: string[]) {
  return tokenScopes.filter((scope) => ![GUD_MCP_WRITE_SCOPE, THOUGHTS_READ_SCOPE, THOUGHTS_WRITE_SCOPE].includes(scope) || grants.includes(scope));
}

export function requestedMcpScopes(rawScope?: string) {
  return rawScope?.split(/\s+/).filter(Boolean) ?? [...GUD_MCP_DEFAULT_SCOPES];
}
