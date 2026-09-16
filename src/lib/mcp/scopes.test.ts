import { describe, expect, it } from "vitest";

import {
  GUD_MCP_DEFAULT_SCOPE,
  GUD_MCP_DEFAULT_SCOPES,
  requestedMcpScopes,
  consentedMcpScopes,
} from "@/lib/mcp/scopes";

describe("GUD MCP OAuth scopes", () => {
  it("does not grant personal data through default scopes or unconsented tokens", () => {
    expect(GUD_MCP_DEFAULT_SCOPES).not.toContain("gud:thoughts:read");
    const requested = ["gud:read", "gud:write", "gud:thoughts:read", "gud:thoughts:write"];
    expect(consentedMcpScopes(requested, ["gud:write"])).toEqual(["gud:read", "gud:write"]);
    expect(consentedMcpScopes(requested, requested)).toEqual(requested);
  });
  it("requests bounded read and write access for a new connection", () => {
    expect(GUD_MCP_DEFAULT_SCOPES).toEqual(expect.arrayContaining(["gud:read", "gud:write"]));
    expect(GUD_MCP_DEFAULT_SCOPE).toBe(GUD_MCP_DEFAULT_SCOPES.join(" "));
    expect(requestedMcpScopes()).toEqual(GUD_MCP_DEFAULT_SCOPES);
  });

  it("honours an explicitly read-only client request", () => {
    expect(requestedMcpScopes("openid gud:read")).toEqual(["openid", "gud:read"]);
  });
});
