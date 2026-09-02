import { describe, expect, it } from "vitest";

import { getMcpAuthorizationResumeUrl } from "@/lib/mcp/oauth-login";

describe("MCP OAuth sign-in return", () => {
  it("resumes the original PKCE authorization request after sign-in", () => {
    const destination = getMcpAuthorizationResumeUrl(
      "?response_type=code&client_id=chatgpt-client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback&scope=gud%3Aread+gud%3Awrite+openid+offline_access&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fcrm.example.com%2Fmcp&state=oauth-state",
    );

    expect(destination).toBe(
      "/api/auth/mcp/authorize?response_type=code&client_id=chatgpt-client&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector%2Foauth%2Fcallback&scope=gud%3Aread+gud%3Awrite+openid+offline_access&code_challenge=challenge&code_challenge_method=S256&resource=https%3A%2F%2Fcrm.example.com%2Fmcp&state=oauth-state",
    );
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
