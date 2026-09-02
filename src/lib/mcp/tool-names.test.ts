import { describe, expect, it } from "vitest";
import {
  normaliseGudMcpPayload,
  normaliseGudMcpRequest,
  normaliseGudMcpToolName,
} from "@/lib/mcp/tool-names";

describe("GUD MCP tool-name compatibility", () => {
  it.each([
    ["gud.describe_workspace", "describe_workspace"],
    ["gud.update_opportunity", "update_opportunity"],
    ["gud_crm.list_opportunities", "list_opportunities"],
    ["gud_crm_update_opportunity", "update_opportunity"],
  ])("maps %s to the registered tool %s", (received, expected) => {
    expect(normaliseGudMcpToolName(received)).toBe(expected);
  });

  it("does not turn unknown names into callable tools", () => {
    expect(normaliseGudMcpToolName("other.update_opportunity")).toBe("other.update_opportunity");
    expect(normaliseGudMcpToolName("gud.execute_sql")).toBe("gud.execute_sql");
  });

  it("normalises namespaced read and write calls in a JSON-RPC batch", () => {
    const discovery = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    const payload = [
      discovery,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "gud.get_opportunity", arguments: {} } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "gud.update_opportunity", arguments: {} } },
    ];
    const normalised = normaliseGudMcpPayload(payload) as Array<{ params?: { name?: string } }>;
    expect(normalised[0]).toBe(discovery);
    expect(normalised[1]?.params?.name).toBe("get_opportunity");
    expect(normalised[2]?.params?.name).toBe("update_opportunity");
  });

  it("rewrites a namespaced HTTP call while retaining OAuth headers", async () => {
    const request = new Request("https://crm.example.com/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer current-oauth-token",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "gud.update_opportunity", arguments: { opportunityId: "example" } },
      }),
    });
    const normalised = await normaliseGudMcpRequest(request);
    expect(normalised.headers.get("authorization")).toBe("Bearer current-oauth-token");
    expect(normalised.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    await expect(normalised.json()).resolves.toMatchObject({ params: { name: "update_opportunity" } });
  });
});
