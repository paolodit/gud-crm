import { oAuthDiscoveryMetadata } from "better-auth/plugins";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const discovery = oAuthDiscoveryMetadata(auth);

export async function GET(request: Request) {
  if (!env.postgresMode || !env.mcpEnabled) return new Response(null, { status: 404 });
  return discovery(request);
}
