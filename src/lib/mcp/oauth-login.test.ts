import { describe, expect, it } from "vitest";

import {
  getMcpAuthorizationResumeUrl,
  mcpConsentHookContext,
  requireMcpConsentPrompt,
} from "@/lib/mcp/oauth-login";

describe("MCP OAuth sign-in return", () => {
  it("requires explicit consent for every MCP authorization grant", () => {
    expect(requireMcpConsentPrompt("/mcp/authorize", {
      scope: "gud:read gud:write",
    })).toEqual({
      scope: "gud:read gud:write",
      prompt: "consent",
    });
    expect(requireMcpConsentPrompt("/mcp/authorize", {
      prompt: "login",
      scope: "gud:read gud:write",
    })).toEqual({
      prompt: "login consent",
      scope: "gud:read gud:write",
    });
    expect(mcpConsentHookContext("/mcp/authorize", {
      scope: "gud:read gud:write",
    })).toEqual({
      context: {
        query: {
          scope: "gud:read gud:write",
          prompt: "consent",
        },
      },
    });
    expect(mcpConsentHookContext("/api/auth/mcp/authorize", {})).toEqual({
      context: { query: { prompt: "consent" } },
    });
  });

  it("does not alter non-MCP authentication requests", () => {
    const query = { callbackURL: "/pipeline" };
    expect(requireMcpConsentPrompt("/sign-in/email", query)).toBe(query);
    expect(mcpConsentHookContext("/sign-in/email", query)).toBeUndefined();
  });

  it("resumes the original PKCE authorization request after sign-in", () => {
    const destination = getMcpAuthorizationResumeUrl(
      "?response_type=code&client_id=chatgpt-client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback&scope=gud%3Aread+gud%3Awrite+openid+offline_access&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fcrm.example.com%2Fmcp&state=oauth-state",
    );

    expect(destination).toBe(
      "/api/auth/mcp/authorize?response_type=code&client_id=chatgpt-client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback&scope=gud%3Aread+gud%3Awrite+openid+offline_access&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fcrm.example.com%2Fmcp&state=oauth-state&prompt=consent",
    );
  });

  it("preserves an existing login prompt while requiring consent", () => {
    expect(getMcpAuthorizationResumeUrl(
      "?response_type=code&client_id=client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&state=state&code_challenge=challenge&code_challenge_method=S256&prompt=login",
    )).toContain("prompt=login+consent");
  });

  it("does not treat an ordinary or incomplete sign-in as an OAuth continuation", () => {
    expect(getMcpAuthorizationResumeUrl("")).toBeNull();
    expect(getMcpAuthorizationResumeUrl("?callbackURL=https://example.com")).toBeNull();
    expect(getMcpAuthorizationResumeUrl("?response_type=code&client_id=client")).toBeNull();
  });

  it("requires the secure PKCE challenge method", () => {
    expect(getMcpAuthorizationResumeUrl(
      "?response_type=code&client_id=client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&state=state&code_challenge=challenge&code_challenge_method=plain",
    )).toBeNull();
  });
});
