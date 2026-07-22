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

  snapshot.offers = [structuredClone(definition.defaultOffer)];
  snapshot.stages = snapshot.stages.map((stage, index) => ({
    ...stage,
    name: definition.stageNames[index] ?? stage.name,
  }));
  snapshot.opportunities = [];
  snapshot.researchThemes = [];
  snapshot.users = snapshot.users.slice(0, 1);

  snapshot.opportunities = snapshot.opportunities.map((item) => ({ ...item, aiSuggestions: [] }));
  return snapshot;
}
