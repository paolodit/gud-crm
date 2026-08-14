import { Suspense } from "react";

import { PipelineBoard } from "@/components/pipeline-board";
import { getSalesBoardSnapshot } from "@/lib/data/board-selectors";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";

export default async function PipelinePage() {
  const member = await getCurrentMember();
  if (!member) return null;
  const snapshot = getSalesBoardSnapshot(await getBoardSnapshot(member.organisationId));
  return (
    <Suspense fallback={<div className="empty-state">Loading pipeline…</div>}>
      <PipelineBoard initialSnapshot={snapshot} currentUserId={member.id} voiceAiConfigured={env.aiEnabled && env.AI_PROVIDER === "openai" && Boolean(env.OPENAI_API_KEY)} />
    </Suspense>
  );
}
