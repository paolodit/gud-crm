import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { McpConsentCard } from "@/components/mcp-consent-card";
import { db } from "@/db";
import { oauthApplications } from "@/db/schema";
import { env } from "@/lib/env";
import { getCurrentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!env.postgresMode || !env.mcpEnabled) notFound();
  const member = await getCurrentMember();
  if (!member) redirect("/sign-in");

  const params = await searchParams;
  const clientId = single(params.client_id);
  const consentCode = single(params.consent_code);
  const requestedScopes = single(params.scope)?.split(/\s+/).filter(Boolean) ?? [];
  if (!clientId || clientId.length > 200 || !consentCode || consentCode.length > 200) notFound();

  const [client] = await db.select({
    name: oauthApplications.name,
  }).from(oauthApplications).where(and(
    eq(oauthApplications.clientId, clientId),
    eq(oauthApplications.disabled, false),
  )).limit(1);
  if (!client) notFound();

  return (
    <McpConsentCard
      clientName={client.name}
      consentCode={consentCode}
      scopes={requestedScopes}
      userName={member.name}
    />
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
