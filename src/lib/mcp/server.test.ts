import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createGudMcpServer, GUD_MCP_TOOL_NAMES } from "@/lib/mcp/server";

const openConnections: Array<{ client: Client; server: ReturnType<typeof createGudMcpServer> }> = [];

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map(async ({ client, server }) => {
    await client.close();
    await server.close();
  }));
});

describe("GUD MCP server", () => {
  it("advertises a focused, annotated tool surface", async () => {
    const { client } = await connectedServer(["gud:read", "gud:write"]);
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual(GUD_MCP_TOOL_NAMES);
    expect(result.tools.find((tool) => tool.name === "list_opportunities")?.annotations?.readOnlyHint).toBe(true);
    expect(result.tools.find((tool) => tool.name === "update_opportunity")?.annotations?.readOnlyHint).toBe(false);
    expect(result.tools.find((tool) => tool.name === "find_work_email")?.annotations?.openWorldHint).toBe(true);
  });

  it("blocks write tools when OAuth granted read-only access", async () => {
    const { client } = await connectedServer(["gud:read"]);
    const result = await client.callTool({
      name: "create_opportunity",
      arguments: {
        companyName: "Example Studio",
        title: "Website discovery",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("read-only access") }),
    ]));
  });
});

async function connectedServer(scopes: string[]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createGudMcpServer({
    actor: {
      id: "test-user",
      name: "Test User",
      email: "test@example.com",
      organisationId: "00000000-0000-4000-8000-000000000001",
      role: "admin",
    },
    scopes,
    clientId: "test-client",
  });
  const client = new Client({ name: "gud-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openConnections.push({ client, server });
  return { client, server };
}
