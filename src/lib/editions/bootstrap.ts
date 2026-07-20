import { demoBoard } from "@/lib/demo-data";
import type { BoardSnapshot, StorageMode } from "@/lib/domain/types";
import { getEdition, type EditionKey } from "@/lib/editions";

export function createInitialSnapshot(editionKey: EditionKey, storageMode: StorageMode): BoardSnapshot {
  const definition = getEdition(editionKey);
  const snapshot = structuredClone(demoBoard);
  snapshot.edition = definition.key;
  snapshot.pipeline.name = definition.pipelineName;
  snapshot.storageMode = storageMode;
  snapshot.demoMode = storageMode === "demo";
  snapshot.generatedAt = new Date().toISOString();

  if (definition.key === "service") {
    snapshot.offers = [structuredClone(definition.defaultOffer)];
    snapshot.stages = snapshot.stages.map((stage, index) => ({
      ...stage,
      name: definition.stageNames[index] ?? stage.name,
    }));
    snapshot.opportunities = [];
    snapshot.users = snapshot.users.slice(0, 1);
  } else {
    snapshot.stages = snapshot.stages.map((stage, index) => ({
      ...stage,
      name: definition.stageNames[index] ?? stage.name,
    }));
  }

  snapshot.opportunities = snapshot.opportunities.map((item) => ({ ...item, aiSuggestions: [] }));
  return snapshot;
}
