import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { demoBoard } from "@/lib/demo-data";
import type {
  AIFeedbackRating,
  AISuggestionSummary,
  BoardSnapshot,
} from "@/lib/domain/types";
import { env } from "@/lib/env";
import { migrateOffersInSnapshot } from "@/lib/domain/offers";
import { createInitialSnapshot } from "@/lib/editions/bootstrap";
import { isEditionKey, normaliseEditionKey } from "@/lib/editions";

const workspaceId = "default";
const snapshotVersion = 15;
const globalForSqlite = globalThis as unknown as { gudLocalDb?: Database.Database };

function database() {
  if (globalForSqlite.gudLocalDb) {
    migrateLocalSnapshot(globalForSqlite.gudLocalDb);
    return globalForSqlite.gudLocalDb;
  }
  const filePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.SQLITE_PATH);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_workspaces (
      id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_feedback (
      suggestion_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (suggestion_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS local_audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const existing = db.prepare("SELECT id FROM local_workspaces WHERE id = ?").get(workspaceId);
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO local_workspaces (id, snapshot_json, updated_at) VALUES (?, ?, ?)").run(
      workspaceId,
      JSON.stringify(freshSnapshot()),
      now,
    );
    db.prepare("INSERT INTO local_settings (key, value, updated_at) VALUES ('snapshot_version', ?, ?)").run(String(snapshotVersion), now);
  }
  migrateLocalSnapshot(db);
  db.prepare("INSERT OR IGNORE INTO local_settings (key, value, updated_at) VALUES ('ai_enabled', 'true', ?)").run(new Date().toISOString());
  globalForSqlite.gudLocalDb = db;
  return db;
}

function migrateLocalSnapshot(db: Database.Database) {
  const versionRow = db.prepare("SELECT value FROM local_settings WHERE key = 'snapshot_version'").get() as { value: string } | undefined;
  const currentVersion = Number(versionRow?.value ?? 0);
  if (currentVersion >= snapshotVersion) return;
  const row = db.prepare("SELECT snapshot_json FROM local_workspaces WHERE id = ?").get(workspaceId) as { snapshot_json: string };
  const snapshot = JSON.parse(row.snapshot_json) as BoardSnapshot;
  if (currentVersion < 7) {
  const usersById = new Map(demoBoard.users.map((user) => [user.id, structuredClone(user)]));
  snapshot.users = [...usersById.values()];
  snapshot.stages = structuredClone(demoBoard.stages);
  const otherActivityType = demoBoard.activityTypes.find((type) => type.id === "21000000-0000-4000-8000-000000000012");
  if (otherActivityType) {
    snapshot.activityTypes = snapshot.activityTypes.some((type) => type.id === otherActivityType.id)
      ? snapshot.activityTypes.map((type) => type.id === otherActivityType.id ? structuredClone(otherActivityType) : type)
      : [...snapshot.activityTypes, structuredClone(otherActivityType)];
    for (const opportunity of snapshot.opportunities) {
      opportunity.activities = opportunity.activities.map((activity) => activity.type.id === otherActivityType.id ? { ...activity, type: structuredClone(otherActivityType) } : activity);
    }
  }
  const outreachStage = snapshot.stages.find((stage) => stage.name === "Outreach active");
  const engagedStage = snapshot.stages.find((stage) => stage.name === "Engaged");
  const researchHoldingStage = snapshot.stages.find((stage) => stage.name === "Research holding");
  const demoById = new Map(demoBoard.opportunities.map((opportunity) => [opportunity.id, opportunity]));
  const lostExample = demoBoard.opportunities.find((opportunity) => opportunity.stageId === "10000000-0000-4000-8000-000000000010");
  if (lostExample && !snapshot.opportunities.some((opportunity) => opportunity.id === lostExample.id)) {
    snapshot.opportunities.push(structuredClone(lostExample));
  }
  for (const opportunity of snapshot.opportunities) {
    if (opportunity.stageId === "10000000-0000-4000-8000-000000000004") {
      opportunity.stageId = "10000000-0000-4000-8000-000000000003";
    }
    opportunity.owner = opportunity.owner ? usersById.get(opportunity.owner.id) ?? opportunity.owner : null;
    opportunity.contacts = opportunity.contacts.map((contact) => ({ ...contact, doNotContact: contact.doNotContact ?? false }));
    opportunity.tasks = opportunity.tasks.map((task) => ({
      ...task,
      owner: task.owner ? usersById.get(task.owner.id) ?? task.owner : null,
    }));

    const currentStage = snapshot.stages.find((stage) => stage.id === opportunity.stageId);
    const hasEngagement = opportunity.activities.some((activity) =>
      activity.type.name === "Received reply" ||
      /positive reply|connected|referred internally|meeting booked/i.test(activity.outcome ?? ""),
    );
    const hasOutboundTouch = opportunity.activities.some((activity) =>
      ["linkedin", "email", "phone", "physical"].includes(activity.type.channel),
    );
    const demoOpportunity = demoById.get(opportunity.id);
    if (demoOpportunity) opportunity.isExample = true;
    const isImportedResearchDisposition =
      opportunity.id !== "51000000-0000-4000-8000-000000000006" &&
      !hasOutboundTouch &&
      ["Lost", "Nurture"].includes(currentStage?.name ?? "");
    if (isImportedResearchDisposition && researchHoldingStage) {
      opportunity.stageId = researchHoldingStage.id;
      opportunity.noNextActionReason ||= "Held as research; not an active sales opportunity";
      continue;
    }
    if (
      currentStage?.terminalType === "open" &&
      engagedStage &&
      hasEngagement &&
      currentStage.position < engagedStage.position
    ) {
      opportunity.stageId = engagedStage.id;
    } else if (
      currentStage?.terminalType === "open" &&
      outreachStage &&
      hasOutboundTouch &&
      currentStage.position < outreachStage.position
    ) {
      opportunity.stageId = outreachStage.id;
    }
  }
  }
  if (currentVersion < 8) migrateOffersInSnapshot(snapshot);
  if (currentVersion < 9 && !isEditionKey(snapshot.edition)) snapshot.edition = "focused";
  if (currentVersion < 10) {
    for (const opportunity of snapshot.opportunities) {
      opportunity.expectedValue ??= null;
      opportunity.probability ??= null;
      opportunity.expectedCloseDate ??= null;
    }
  }
  if (currentVersion < 11) {
    snapshot.edition = normaliseEditionKey((snapshot as unknown as { edition?: unknown }).edition);
  }
  if (currentVersion < 12) {
    const nextByStage = new Map<string, number>();
    for (const opportunity of snapshot.opportunities) {
      const next = (nextByStage.get(opportunity.stageId) ?? 0) + 1000;
      opportunity.position = next;
      nextByStage.set(opportunity.stageId, next);
    }
  }
  if (currentVersion < 13) snapshot.researchThemes = [];
  if (currentVersion < 14) simplifyPipelineStages(snapshot);
  if (currentVersion < 15) {
    for (const opportunity of snapshot.opportunities) {
      opportunity.archivedAt ??= null;
      opportunity.company.archivedAt ??= null;
    }
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE local_workspaces SET snapshot_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(snapshot), now, workspaceId);
  db.prepare("INSERT INTO local_settings (key, value, updated_at) VALUES ('snapshot_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(String(snapshotVersion), now);
}

function simplifyPipelineStages(snapshot: BoardSnapshot) {
  const sourceStages = [...snapshot.stages];
  const researching = sourceStages.find((stage) => stage.name === "Researching");
  const researchHolding = sourceStages.find((stage) => stage.name === "Research holding");
  const outreach = sourceStages.find((stage) => stage.name === "Outreach active");
  const conversation = sourceStages.find((stage) => ["Conversation active", "Engaged"].includes(stage.name)) ?? sourceStages.find((stage) => ["Discovery booked", "Review booked"].includes(stage.name));
  const proposal = sourceStages.find((stage) => ["Proposal / decision", "Proposal sent", "Pilot proposed", "Trial proposed"].includes(stage.name)) ?? sourceStages.find((stage) => ["Decision pending", "Pilot active", "Trial active"].includes(stage.name));
  const won = sourceStages.find((stage) => stage.name === "Won");
  const lost = sourceStages.find((stage) => stage.name === "Lost");
  const destinationByName = new Map<string, string | undefined>([
    ["Ready to contact", researching?.id],
    ["Engaged", conversation?.id],
    ["Conversation active", conversation?.id],
    ["Discovery booked", conversation?.id],
    ["Review booked", conversation?.id],
    ["Nurture", conversation?.id],
    ["Pilot proposed", proposal?.id],
    ["Pilot active", proposal?.id],
    ["Trial proposed", proposal?.id],
    ["Trial active", proposal?.id],
    ["Proposal sent", proposal?.id],
    ["Decision pending", proposal?.id],
  ]);
  const stageById = new Map(sourceStages.map((stage) => [stage.id, stage]));
  for (const opportunity of snapshot.opportunities) {
    const current = stageById.get(opportunity.stageId);
    const destination = current ? destinationByName.get(current.name) : null;
    if (destination) opportunity.stageId = destination;
  }
  if (conversation) Object.assign(conversation, { name: "Conversation active", colour: "#00A86B", terminalType: "open" as const });
  if (proposal) Object.assign(proposal, { name: "Proposal / decision", colour: "#D98200", terminalType: "open" as const });
  snapshot.stages = [researching, researchHolding, outreach, conversation, proposal, won, lost].filter((stage): stage is NonNullable<typeof stage> => Boolean(stage));
  snapshot.stages.forEach((stage, index) => { stage.position = (index + 1) * 1000; });
  const nextByStage = new Map<string, number>();
  for (const opportunity of snapshot.opportunities) {
    const position = (nextByStage.get(opportunity.stageId) ?? 0) + 1000;
    opportunity.position = position;
    nextByStage.set(opportunity.stageId, position);
  }
}

function freshSnapshot(): BoardSnapshot {
  return createInitialSnapshot(env.defaultEdition, "sqlite");
}

export function getLocalBoardSnapshot(): BoardSnapshot {
  const row = database()
    .prepare("SELECT snapshot_json FROM local_workspaces WHERE id = ?")
    .get(workspaceId) as { snapshot_json: string };
  const snapshot = JSON.parse(row.snapshot_json) as BoardSnapshot;
  snapshot.demoMode = false;
  snapshot.storageMode = "sqlite";
  snapshot.generatedAt = new Date().toISOString();
  snapshot.researchThemes ??= [];
  snapshot.researchThemes = snapshot.researchThemes
    .map((theme, index) => ({ ...theme, position: theme.position ?? (index + 1) * 1000 }))
    .sort((a, b) => a.position - b.position);
  return snapshot;
}

export function updateLocalBoardSnapshot<T>(mutate: (snapshot: BoardSnapshot) => T): T {
  const db = database();
  return db.transaction(() => {
    const snapshot = getLocalBoardSnapshot();
    const result = mutate(snapshot);
    snapshot.generatedAt = new Date().toISOString();
    db.prepare("UPDATE local_workspaces SET snapshot_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(snapshot),
      snapshot.generatedAt,
      workspaceId,
    );
    return result;
  })();
}

export function getLocalAiEnabled() {
  const row = database().prepare("SELECT value FROM local_settings WHERE key = 'ai_enabled'").get() as { value: string } | undefined;
  return row?.value === "true";
}

export function setLocalAiEnabled(enabled: boolean) {
  database()
    .prepare("INSERT INTO local_settings (key, value, updated_at) VALUES ('ai_enabled', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(String(enabled), new Date().toISOString());
}

export function getLocalSetting<T>(key: string): T | null {
  const row = database().prepare("SELECT value FROM local_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

export function setLocalSetting(key: string, value: unknown) {
  database()
    .prepare("INSERT INTO local_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export async function createLocalDatabaseBackup(destination: string) {
  return database().backup(destination);
}

export function consumeLocalAiRateLimit(bucketKey: string, limit: number, windowMs: number) {
  const db = database();
  return db.transaction(() => {
    const now = Date.now();
    const row = db.prepare("SELECT window_started_at, request_count FROM ai_rate_limits WHERE bucket_key = ?").get(bucketKey) as { window_started_at: number; request_count: number } | undefined;
    if (!row || now - row.window_started_at >= windowMs) {
      db.prepare("INSERT INTO ai_rate_limits (bucket_key, window_started_at, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = 1").run(bucketKey, now);
      return true;
    }
    if (row.request_count >= limit) return false;
    db.prepare("UPDATE ai_rate_limits SET request_count = request_count + 1 WHERE bucket_key = ?").run(bucketKey);
    return true;
  })();
}

export function recordLocalAuditEvent(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}) {
  database()
    .prepare("INSERT INTO local_audit_events (id, actor_id, action, entity_type, entity_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      crypto.randomUUID(),
      input.actorId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.detail ?? {}),
      new Date().toISOString(),
    );
}

export function saveLocalAiSuggestion(suggestion: AISuggestionSummary) {
  updateLocalBoardSnapshot((snapshot) => {
    const opportunity = snapshot.opportunities.find((item) => item.id === suggestion.opportunityId);
    if (!opportunity) throw new Error("Opportunity not found.");
    opportunity.aiSuggestions = [suggestion, ...(opportunity.aiSuggestions ?? [])].slice(0, 12);
  });
}

export function getLocalAiSuggestion(opportunityId: string, suggestionId: string) {
  const opportunity = getLocalBoardSnapshot().opportunities.find((item) => item.id === opportunityId);
  return opportunity?.aiSuggestions?.find((item) => item.id === suggestionId) ?? null;
}

export function saveLocalAiFeedback(suggestionId: string, userId: string, rating: AIFeedbackRating, reason?: string | null) {
  database()
    .prepare("INSERT INTO ai_feedback (suggestion_id, user_id, rating, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET rating = excluded.rating, reason = excluded.reason, created_at = excluded.created_at")
    .run(suggestionId, userId, rating, reason ?? null, new Date().toISOString());
  updateLocalBoardSnapshot((snapshot) => {
    for (const opportunity of snapshot.opportunities) {
      const suggestion = opportunity.aiSuggestions?.find((item) => item.id === suggestionId);
      if (suggestion) suggestion.feedbackRating = rating;
    }
  });
}

export function resetLocalWorkspace() {
  const snapshot = freshSnapshot();
  database().prepare("UPDATE local_workspaces SET snapshot_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(snapshot),
    snapshot.generatedAt,
    workspaceId,
  );
  return snapshot;
}

export function localWorkspaceStatus() {
  const snapshot = getLocalBoardSnapshot();
  return {
    file: path.resolve(/* turbopackIgnore: true */ process.cwd(), env.SQLITE_PATH),
    opportunities: snapshot.opportunities.length,
    activities: snapshot.opportunities.reduce((sum, item) => sum + item.activities.length, 0),
    tasks: snapshot.opportunities.reduce((sum, item) => sum + item.tasks.length, 0),
    suggestions: snapshot.opportunities.reduce((sum, item) => sum + (item.aiSuggestions?.length ?? 0), 0),
  };
}

export function exportLocalWorkspace(destination: string) {
  const outputPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), destination);
  writeFileSync(outputPath, `${JSON.stringify(getLocalBoardSnapshot(), null, 2)}\n`, "utf8");
  return outputPath;
}
