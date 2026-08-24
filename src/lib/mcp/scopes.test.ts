import { describe, expect, it } from "vitest";

import {
  GUD_MCP_DEFAULT_SCOPE,
  GUD_MCP_DEFAULT_SCOPES,
  requestedMcpScopes,
} from "@/lib/mcp/scopes";

describe("GUD MCP OAuth scopes", () => {
  it("requests bounded read and write access for a new connection", () => {
    expect(GUD_MCP_DEFAULT_SCOPES).toEqual(expect.arrayContaining(["gud:read", "gud:write"]));
    expect(GUD_MCP_DEFAULT_SCOPE).toBe(GUD_MCP_DEFAULT_SCOPES.join(" "));
    expect(requestedMcpScopes()).toEqual(GUD_MCP_DEFAULT_SCOPES);
  });

  it("honours an explicitly read-only client request", () => {
    expect(requestedMcpScopes("openid gud:read")).toEqual(["openid", "gud:read"]);
  });
});
