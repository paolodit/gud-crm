import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { withMcpAuth } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { oauthConsents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { createGudMcpServer } from "@/lib/mcp/server";
import { getMcpActor } from "@/lib/mcp/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const authenticatedHandler = withMcpAuth(auth, async (request, session) => {
  if (!env.postgresMode || !env.mcpEnabled) {
    return Response.json(
      { error: "Remote MCP connections are not enabled for this deployment." },
      { status: 503 },
    );
  }
  if (!isExpectedHost(request)) {
    return Response.json({ error: "Unexpected MCP host." }, { status: 421 });
  }
  const tokenScopes = session.scopes.split(/\s+/).filter(Boolean);
  const writeConsent = tokenScopes.includes("gud:write")
    ? await hasWriteConsent(session.clientId, session.userId)
    : false;
  const scopes = tokenScopes.filter((scope) => scope !== "gud:write" || writeConsent);
  if (!scopes.includes("gud:read")) {
    return Response.json(
      { error: "The GUD connection does not include gud:read permission." },
      { status: 403 },
    );
  }
  const actor = await getMcpActor(session.userId);
  if (!actor) {
    return Response.json({ error: "The GUD user is inactive or no longer belongs to this workspace." }, { status: 403 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createGudMcpServer({ actor, scopes, clientId: session.clientId });
  await server.connect(transport);
  const response = await transport.handleRequest(request, {
    authInfo: {
      token: session.accessToken,
      clientId: session.clientId,
      scopes,
      expiresAt: Math.floor(session.accessTokenExpiresAt.getTime() / 1000),
      resource: new URL(`${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/mcp`),
      extra: { userId: actor.id, organisationId: actor.organisationId },
    },
  });
  return responseWithCors(response);
});

export async function GET(request: Request) {
  return responseWithCors(await authenticatedHandler(request));
}

export async function POST(request: Request) {
  return responseWithCors(await authenticatedHandler(request));
}

export async function DELETE(request: Request) {
  return responseWithCors(await authenticatedHandler(request));
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function responseWithCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function isExpectedHost(request: Request) {
  const expected = new URL(env.NEXT_PUBLIC_APP_URL).host.toLowerCase();
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const received = forwarded || request.headers.get("host")?.toLowerCase() || new URL(request.url).host.toLowerCase();
  return received === expected;
}

async function hasWriteConsent(clientId: string, userId: string) {
  const grants = await db.select({ scopes: oauthConsents.scopes }).from(oauthConsents).where(and(
    eq(oauthConsents.clientId, clientId),
    eq(oauthConsents.userId, userId),
    eq(oauthConsents.consentGiven, true),
  ));
  return grants.some((grant) => grant.scopes.split(/\s+/).includes("gud:write"));
}
