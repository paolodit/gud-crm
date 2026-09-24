import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withDatabaseTransaction } from "@/db";
import { companies, contacts, gudActionDrafts, opportunities, organisations, researchThemes, tasks } from "@/db/schema";
import { getBoardSnapshot } from "@/lib/data/crm-repository";
import { updateDelivery } from "@/lib/data/delivery-repository";
import { mutateLiveWorkspace } from "@/lib/data/live-workspace";
import { getThought, listThoughts, saveThought } from "@/lib/data/thoughts-repository";
import { deliveryDetails, directProjectSchema, liveProjectRecords } from "@/lib/domain/delivery";
import { assertPrivateThoughtAccess, thoughtLabel } from "@/lib/domain/thoughts";
import { voiceLocalToIso } from "@/lib/domain/voice-workspace";
import { env } from "@/lib/env";
import { normaliseName } from "@/lib/domain/normalise";
import { completeTask, createOpportunity, logActivity, saveContact, setNextAction, updateCompany, updateOpportunity } from "@/lib/mcp/service";
import type { CurrentMember } from "@/lib/session";
import { assertFieldScope, draftInputSchema, fieldsSchema, GudActionError, recordHref, recordSchema, type GudDraft, type GudDraftInput } from "./contract";

import { readIdea, saveIdea, validateResearchLinks } from "./research-records";
import { isResearchStage } from "@/lib/data/board-selectors";

export function assertConversationActor(actor: CurrentMember) {
  if (env.GUD_CONVERSATION_ENABLED !== "true") throw new GudActionError("Conversation preview is disabled on this workspace.");
  if (actor.storageMode !== "postgres") throw new GudActionError("Conversation preview currently needs a signed-in PostgreSQL workspace. The existing voice tools still work here.");
  if (actor.impersonated) throw new GudActionError("End impersonation before starting a private conversation.");
}
const scope = (actor: CurrentMember) => and(eq(gudActionDrafts.organisationId, actor.organisationId), eq(gudActionDrafts.ownerId, actor.id));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const privateCheck = (actor: CurrentMember) => assertPrivateThoughtAccess({ ...actor, publicDemo: env.publicDemo });

export async function actionReferences(actor: CurrentMember) {
  assertConversationActor(actor);
  const snapshot = await getBoardSnapshot(actor.organisationId, { opportunityIds: [], includeHistory: false });
  return { ideas: snapshot.researchThemes.map(({ id, title }) => ({ id, title })), offers: snapshot.offers.filter(x => x.active).map(({ id, name }) => ({ id, name })), stages: snapshot.stages.filter(x => x.terminalType === "open").map(({ id, name }) => ({ id, name })), projectStages: snapshot.deliveryStages ?? [], owners: snapshot.users.map(({ id, name }) => ({ id, name })), activityTypes: snapshot.activityTypes.map(({ id, name }) => ({ id, name })), thoughtsAllowed: !actor.demoMode && !actor.impersonated };
}
export async function searchRecords(actor: CurrentMember, query: string, kind: "all" | "lead" | "project" | "thought" | "idea" | "target") {
  assertConversationActor(actor);
  const needle = z.string().trim().min(2).max(120).parse(query).toLowerCase();
  if (kind === "thought") {
    privateCheck(actor);
    const matches = (await listThoughts(actor)).filter(note => !note.archived && `${note.title} ${note.body} ${note.category}`.toLowerCase().includes(needle)).map(note => ({ kind: "thought" as const, id: note.id, title: thoughtLabel(note), category: note.category }));
    return { matches: matches.slice(0, 20), more: matches.length > 20 };
  }
  if (kind === "idea") {
    const rows = await db.select().from(researchThemes).where(eq(researchThemes.organisationId, actor.organisationId));
    const matches = rows.filter(r => `${r.title} ${r.audience ?? ""} ${r.problem ?? ""}`.toLowerCase().includes(needle)).map(r => ({ kind: "idea" as const, id: r.id, title: r.title }));
    return { matches: matches.slice(0, 20), more: matches.length > 20 };
  }
  const snapshot = await getBoardSnapshot(actor.organisationId, { includeHistory: false });
  if (kind === "target") {
    const matches = snapshot.opportunities.filter(x => !x.archivedAt && !x.company.archivedAt && isResearchStage(snapshot.stages.find(s => s.id === x.stageId)) && `${x.title} ${x.company.name} ${x.contacts.map(c => c.name).join(" ")}`.toLowerCase().includes(needle)).map(x => ({ kind: "target" as const, id: x.id, title: x.title, company: x.company.name }));
    return { matches: matches.slice(0, 20), more: matches.length > 20 };
  }
  const leads = snapshot.opportunities.filter(x => !x.archivedAt && !x.company.archivedAt && `${x.company.name} ${x.title} ${x.contacts.map(c => c.name).join(" ")}`.toLowerCase().includes(needle)).map(x => ({ kind: "lead" as const, id: x.id, company: x.company.name, title: x.title }));
  const projects = liveProjectRecords(snapshot).filter(x => !x.delivery.archivedAt && `${x.companyName} ${x.title}`.toLowerCase().includes(needle)).map(x => ({ kind: "project" as const, id: x.id, company: x.companyName, title: x.title }));
  const matches = kind === "lead" ? leads : kind === "project" ? projects : [...leads, ...projects];
  return { matches: matches.slice(0, 20), more: matches.length > 20 };
}
async function selected(actor: CurrentMember, record: { kind: "lead" | "project" | "target"; id: string }) {
  const snapshot = await getBoardSnapshot(actor.organisationId, { opportunityIds: [record.id], includeHistory: false });
  if (record.kind === "project") {
    const project = liveProjectRecords(snapshot).find(x => x.id === record.id && !x.delivery.archivedAt);
    if (!project) throw new GudActionError("That active project is unavailable in this workspace.");
    return { snapshot, project, lead: undefined };
  }
  const lead = snapshot.opportunities.find(x => x.id === record.id && !x.archivedAt && !x.company.archivedAt);
  if (!lead) throw new GudActionError("That active lead is unavailable in this workspace.");
  if (record.kind === "target" && !isResearchStage(snapshot.stages.find(s => s.id === lead.stageId))) throw new GudActionError("That record is now in Pipeline. Open it there before editing.");
  return { snapshot, lead, project: undefined };
}
function baseline(value: Awaited<ReturnType<typeof selected>>) {
  return hash(value.project ?? { id: value.lead!.id, title: value.lead!.title, stageId: value.lead!.stageId, expectedValue: value.lead!.expectedValue, offer: value.lead!.offer?.id, owner: value.lead!.owner?.id, priority: value.lead!.priority, temperature: value.lead!.temperature, probability: value.lead!.probability, expectedCloseDate: value.lead!.expectedCloseDate, outreachAngle: value.lead!.outreachAngle, tasks: value.lead!.tasks, contacts: value.lead!.contacts, company: value.lead!.company, researchThemeIds: value.lead!.researchThemeIds });
}
export async function openRecord(actor: CurrentMember, input: unknown) {
  assertConversationActor(actor);
  const record = recordSchema.parse(input);
  if (record.kind === "idea") return { ...await readIdea(actor, record.id), ...record, href: recordHref(record), value: null, contacts: [], tasks: [] };
  if (record.kind === "thought") {
    privateCheck(actor);
    const note = await getThought(actor, record.id);
    if (note.archived) throw new GudActionError("Restore this Thought in the board before changing it.");
    return { ...record, href: recordHref(record), title: note.title, body: note.body, colour: note.colour, category: note.category, version: note.version, tasks: note.checklist.map(t => ({ id: t.id, title: t.text, completed: t.done })), contacts: [], value: null };
  }
  const { lead, project } = await selected(actor, { kind: record.kind, id: record.id });
  return { ...record, href: recordHref(record), company: project?.companyName ?? lead!.company.name, title: project?.title ?? lead!.title, value: project?.delivery.projectValue ?? lead?.expectedValue ?? null,
    stageId: project?.delivery.stage ?? lead!.stageId,
    tasks: project ? (project.delivery.tasks ?? []).map(t => ({ id: t.id, title: t.text, completed: t.completed })) : lead!.tasks.map(t => ({ id: t.id, title: t.title, completed: t.status !== "open", dueAt: t.dueAt })),
    contacts: lead?.contacts.map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title })) ?? [],
    details: project ? { ownerId: project.ownerId, offerId: project.offerId, nextMilestone: project.delivery.nextMilestone, dueDate: project.delivery.dueDate, notes: project.delivery.notes } : { ownerId: lead!.owner?.id, offerId: lead!.offer?.id, priority: lead!.priority, temperature: lead!.temperature, probability: lead!.probability, expectedCloseDate: lead!.expectedCloseDate, outreachAngle: lead!.outreachAngle, fitScore: lead!.company.fitScore, qualificationNote: lead!.company.scaleNote, researchThemeIds: lead!.researchThemeIds ?? [] },
  };
}
export async function listDrafts(actor: CurrentMember) {
  assertConversationActor(actor);
  const rows = await db.select({ document: gudActionDrafts.document }).from(gudActionDrafts).where(and(scope(actor), sql`${gudActionDrafts.document}->>'status' = 'draft'`, sql`${gudActionDrafts.document}->>'expiresAt' > ${new Date().toISOString()}`)).orderBy(desc(gudActionDrafts.updatedAt)).limit(30);
  return rows.map(x => x.document).filter(x => x.status === "draft" && Date.parse(x.expiresAt) > Date.now());
}
async function ownedDraft(actor: CurrentMember, id: string, lock = false) {
  const query = db.select().from(gudActionDrafts).where(and(scope(actor), eq(gudActionDrafts.id, id))).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new GudActionError("This draft is unavailable. Reload your conversation.");
  return row.document;
}
function assertEditable(draft: GudDraft, version: number) {
  if (draft.status !== "draft") throw new GudActionError("This draft has already been saved or cancelled.");
  if (draft.version !== version) throw new GudActionError("This draft changed while you were talking. Your manual edits have been kept; review it before retrying.");
  if (Date.parse(draft.expiresAt) <= Date.now()) throw new GudActionError("This draft expired. Start a fresh review using the current record.");
}
async function validate(actor: CurrentMember, input: GudDraftInput, saving = false) {
  assertFieldScope(input);
  const f = input.fields;
  const warnings: string[] = [];
  if (saving && !Object.values(f).some(value => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value !== undefined)) throw new GudActionError("This draft has no changes to save.");
  if (input.kind === "thought") {
    privateCheck(actor);
    const note = input.targetId ? await getThought(actor, input.targetId) : null;
    if (note?.archived) throw new GudActionError("Restore this Thought in the board before changing it.");
    if (saving && !input.targetId && !f.title?.trim() && !f.body?.trim() && !f.addTasks?.length) throw new GudActionError("Add some text to the Thought.");
    if (f.title && f.title.length > 160) throw new GudActionError("Thought titles can be at most 160 characters.");
    if (f.completeTaskIds?.some(id => !note?.checklist.some(t => t.id === id && !t.done))) throw new GudActionError("Read this Thought again before completing its checklist items.");
    return warnings;
  }
  await validateResearchLinks(actor, f);
  if (input.kind === "idea") {
    if (f.title !== undefined && f.title.length < 2) throw new GudActionError("Use at least two characters for the idea title.");
    if (input.targetId) await readIdea(actor, input.targetId);
    if (saving && !input.targetId && (!f.title || f.title.length < 2)) throw new GudActionError("Add a title for the marketing idea.");
    return warnings;
  }
  const refs = await actionReferences(actor);
  if (saving && input.kind === "target" && !input.targetId && !refs.stages.some(s => s.id === f.stageId && (s.name === "Researching" || s.name === "Research holding"))) throw new GudActionError("Choose a research stage for a new target.");
  if (input.kind === "target" && f.clearOffer && f.stageId && !isResearchStage(refs.stages.find(s => s.id === f.stageId))) throw new GudActionError("Choose a service before moving a target into Pipeline. An idea-only target can stay in research.");
  if (f.stageId && !(input.kind === "lead" || input.kind === "target" ? refs.stages : refs.projectStages).some(s => s.id === f.stageId)) throw new GudActionError("Choose an available stage. Won/lost sales moves are not part of this preview.");
  if (f.offerId && !refs.offers.some(o => o.id === f.offerId)) throw new GudActionError("Choose an available offer.");
  if (f.ownerId && !refs.owners.some(o => o.id === f.ownerId)) throw new GudActionError("Choose an available owner.");
  if (f.activityTypeId && !refs.activityTypes.some(o => o.id === f.activityTypeId)) throw new GudActionError("Choose an available activity type.");
  if ((f.contactEmail || f.contactPhone || f.contactTitle || f.contactLinkedinUrl || f.contactId) && !f.contact) throw new GudActionError("Include the contact's name when adding or updating contact details.");
  if (!input.targetId && f.contactId) throw new GudActionError("Use a contact name for a new opportunity, not an unrelated contact ID.");
  if (!input.targetId && (!f.company || !f.title)) { if (saving) throw new GudActionError("Add a company and title before saving."); warnings.push("Add a company and title before saving."); }
  if (input.kind === "lead" && !input.targetId && !f.offerId) { if (saving) throw new GudActionError("Choose the offer for this lead."); warnings.push("Choose an offer before saving."); }
  if ((input.kind === "lead" || input.kind === "target") && f.task) {
    if (!f.dueDate || !f.dueTime) { if (saving) throw new GudActionError("Choose a date and time for the follow-up."); warnings.push("Choose a follow-up date and time."); }
    else if (!voiceLocalToIso(`${f.dueDate}T${f.dueTime}`, input.timezone)) throw new GudActionError("That follow-up time is invalid or ambiguous around a clock change.");
  }
  if (input.kind === "project" && f.task && f.dueDate) warnings.push("The date belongs to the project milestone. This checklist item has no separate due date.");
  if (input.targetId) {
    const target = await selected(actor, { kind: input.kind, id: input.targetId });
    if (f.contactId && !target.lead?.contacts.some(c => c.id === f.contactId)) throw new GudActionError("That contact is not linked to this opportunity.");
    if (input.kind === "project" && target.project?.source === "sales" && (f.company !== undefined || f.title !== undefined)) throw new GudActionError("Change the title/company on its sales record. Project delivery fields can be staged here.");
    const ids = target.project ? (target.project.delivery.tasks ?? []).filter(t => !t.completed).map(t => t.id) : target.lead!.tasks.filter(t => t.status === "open").map(t => t.id);
    if (f.completeTaskIds?.some(id => !ids.includes(id))) throw new GudActionError("A selected task is no longer open on this record. Read it again.");
  } else if (f.completeTaskIds?.length) throw new GudActionError("Choose an existing record before completing a task.");
  return warnings;
}
export async function stageDraft(actor: CurrentMember, input: unknown, revision?: { id: string; version: number; appendTasks?: boolean }) {
  assertConversationActor(actor);
  const data = draftInputSchema.parse(input);
  return withDatabaseTransaction(async () => {
    await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, actor.organisationId)).for("update");
    const prior = revision ? await ownedDraft(actor, z.uuid().parse(revision.id), true) : null;
    if (prior) {
      assertEditable(prior, revision!.version);
      if (prior.kind !== data.kind || prior.targetId !== data.targetId) throw new GudActionError("A draft cannot be moved to another record. Start a separate draft.");
    } else if ((await listDrafts(actor)).length >= 8) throw new GudActionError("Save or cancel some drafts before starting another.");
    const merged = { ...data, fields: { ...prior?.fields, ...data.fields } };
    if (data.fields.clearOffer && data.fields.offerId) throw new GudActionError("Choose a service or clear it, not both.");
    if (data.fields.clearOffer) delete merged.fields.offerId;
    else if (data.fields.offerId && (data.kind === "idea" || data.kind === "target")) merged.fields.clearOffer = false;
    // Lists accumulate across conversational turns instead of silently replacing
    // the task the user dictated in the preceding turn.
    if (prior && revision?.appendTasks && data.fields.addTasks) merged.fields.addTasks = [...prior.fields.addTasks ?? [], ...data.fields.addTasks];
    if (prior && revision?.appendTasks && data.fields.note) merged.fields.note = [prior.fields.note, data.fields.note].filter(Boolean).join("\n\n");
    merged.fields = fieldsSchema.parse(merged.fields);
    const warnings = await validate(actor, merged);
    const record = data.targetId && data.kind !== "thought" && data.kind !== "idea" ? await selected(actor, { kind: data.kind, id: data.targetId }) : null;
    const idea = data.kind === "idea" && data.targetId ? await readIdea(actor, data.targetId) : null;
    const thought = data.targetId && data.kind === "thought" ? await getThought(actor, data.targetId) : null;
    const refs = await actionReferences(actor);
    if (!prior && !data.targetId && data.kind === "lead") {
      if (!merged.fields.stageId) { merged.fields.stageId = refs.stages.find(s => s.name === "Outreach active")?.id ?? refs.stages[0]?.id; warnings.push("Review the suggested initial sales stage."); }
      if (!merged.fields.offerId && refs.offers.length === 1) merged.fields.offerId = refs.offers[0].id;
    }
    if (!data.targetId && data.kind === "target" && !merged.fields.stageId) merged.fields.stageId = refs.stages.find(s => s.name === "Researching")?.id;
    if (!data.targetId && data.kind === "project" && !merged.fields.stageId) merged.fields.stageId = refs.projectStages[0]?.id;
    const draft: GudDraft = { ...merged, id: prior?.id ?? crypto.randomUUID(), version: (prior?.version ?? 0) + 1, status: "draft", expiresAt: prior?.expiresAt ?? new Date(Date.now() + 86400000).toISOString(), baseline: prior?.baseline ?? (idea ? hash(idea) : thought ? String(thought.version) : record ? baseline(record) : "new"), label: idea ? idea.title : thought ? thoughtLabel(thought) : record?.project ? `${record.project.companyName} · ${record.project.title}` : record?.lead ? `${record.lead.company.name} · ${record.lead.title}` : merged.fields.title || `New ${data.kind}`, warnings };
    draft.taskOptions = record?.project ? (record.project.delivery.tasks ?? []).filter(t => !t.completed).map(t => ({ id: t.id, title: t.text })) : record?.lead?.tasks.filter(t => t.status === "open").map(t => ({ id: t.id, title: t.title })) ?? [];
    if (thought) draft.taskOptions = thought.checklist.filter(t => !t.done).map(t => ({ id: t.id, title: t.text }));
    if (prior) await db.update(gudActionDrafts).set({ document: draft, updatedAt: new Date() }).where(and(scope(actor), eq(gudActionDrafts.id, draft.id)));
    else await db.insert(gudActionDrafts).values({ id: draft.id, organisationId: actor.organisationId, ownerId: actor.id, document: draft });
    return draft;
  });
}
export async function editDraft(actor: CurrentMember, id: string, version: number, fields: unknown) {
  const prior = await ownedDraft(actor, z.uuid().parse(id));
  return stageDraft(actor, { kind: prior.kind, targetId: prior.targetId, timezone: prior.timezone, fields: fieldsSchema.parse(fields) }, { id, version });
}
export async function cancelDraft(actor: CurrentMember, id: string, version: number) {
  assertConversationActor(actor);
  return withDatabaseTransaction(async () => {
    const prior = await ownedDraft(actor, z.uuid().parse(id), true);
    assertEditable(prior, version);
    await db.update(gudActionDrafts).set({ document: { ...prior, status: "cancelled", fields: {}, baseline: "", version: prior.version + 1 }, updatedAt: new Date() }).where(and(scope(actor), eq(gudActionDrafts.id, id)));
  });
}
async function saveOne(actor: CurrentMember, draft: GudDraft) {
  const f = draft.fields;
  if (draft.kind === "idea") return saveIdea(actor, draft);
  if (draft.kind === "thought") {
    const existing = draft.targetId ? await getThought(actor, draft.targetId) : null;
    const category = f.category === undefined ? existing?.category ?? "" : (await listThoughts(actor)).find(note => note.category.toLowerCase() === f.category!.toLowerCase())?.category ?? f.category;
    const content = { title: f.title ?? existing?.title ?? "", body: f.body ?? existing?.body ?? "", colour: f.colour ?? existing?.colour ?? "butter", category, x: existing?.x ?? 24, y: existing?.y ?? 24, checklist: [...existing?.checklist ?? [], ...f.addTasks?.map(text => ({ id: crypto.randomUUID(), text, done: false })) ?? []].map(t => ({ ...t, done: t.done || Boolean(f.completeTaskIds?.includes(t.id)) })) };
    const thought = await saveThought(actor, { ...(existing ? { id: existing.id, version: Number(draft.baseline) } : {}), content });
    return { href: recordHref({ kind: "thought", id: thought.id }), label: thought.title || "Private thought" };
  }
  if (draft.kind === "lead" || draft.kind === "target") {
    const dueAt = f.task && f.dueDate && f.dueTime ? new Date(voiceLocalToIso(`${f.dueDate}T${f.dueTime}`, draft.timezone)!) : null;
    const details = { title: f.title, expectedValue: f.value, offerId: f.offerId, stageId: f.stageId, ownerId: f.ownerId, priority: f.priority, temperature: f.temperature, probability: f.probability, expectedCloseDate: f.expectedCloseDate ? new Date(`${f.expectedCloseDate}T12:00:00Z`) : undefined, outreachAngle: f.outreachAngle };
    let id = draft.targetId;
    if (!id) {
      const matches = await db.select({ id: companies.id, archivedAt: companies.archivedAt }).from(companies).where(and(eq(companies.organisationId, actor.organisationId), eq(companies.normalisedName, normaliseName(f.company!)))).limit(2);
      if (matches.length > 1 || matches.some(c => c.archivedAt)) throw new GudActionError("The company match is ambiguous or archived. Resolve it in Companies first.");
      if (matches[0] && f.contact) {
        const people = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organisationId, actor.organisationId), eq(contacts.companyId, matches[0].id), eq(contacts.normalisedName, normaliseName(f.contact)))).limit(2);
        if (people.length > 1) throw new GudActionError("The contact match is ambiguous. Resolve it in the contact editor first.");
      }
      const created = await createOpportunity(actor, { ...details, companyName: f.company!, title: f.title!, ...(f.contact ? { contact: { name: f.contact, email: f.contactEmail, phone: f.contactPhone, title: f.contactTitle, linkedinUrl: f.contactLinkedinUrl } } : {}), ...(f.task && dueAt ? { nextAction: { title: f.task, dueAt } } : {}) });
      id = created.id;
    } else {
      if (Object.values(details).some(x => x !== undefined)) await updateOpportunity(actor, { opportunityId: id, ...details });
      if (f.contact) {
        const { lead } = await selected(actor, { kind: "lead", id });
        if (!f.contactId) {
          const matches = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organisationId, actor.organisationId), eq(contacts.companyId, lead!.company.id), eq(contacts.normalisedName, normaliseName(f.contact)))).limit(2);
          if (matches.length > 1) throw new GudActionError("More than one contact has that name. Select the exact contact before saving.");
        }
        await saveContact(actor, { opportunityId: id, contactId: f.contactId, name: f.contact, email: f.contactEmail, phone: f.contactPhone, title: f.contactTitle, linkedinUrl: f.contactLinkedinUrl });
      }
      if (f.task && dueAt) await setNextAction(actor, { opportunityId: id, title: f.task, dueAt });
    }
    if (f.fitScore !== undefined || f.qualificationNote !== undefined || f.websiteUrl !== undefined || f.sector !== undefined || f.companyLinkedinUrl !== undefined || f.researchNote !== undefined || f.sourceUrls !== undefined || (draft.kind === "target" && f.company !== undefined)) {
      const { lead } = await selected(actor, { kind: "lead", id });
      await updateCompany(actor, { companyId: lead!.company.id, fitScore: f.fitScore, scaleNote: f.qualificationNote, websiteUrl: f.websiteUrl, linkedinUrl: f.companyLinkedinUrl, sector: f.sector, researchNoteAppend: f.researchNote, sourceUrls: f.sourceUrls, ...(draft.kind === "target" && f.company ? { name: f.company } : {}) });
    }
    if (f.note || f.activityTypeId || f.activityOutcome) {
      const snapshot = await getBoardSnapshot(actor.organisationId, { opportunityIds: [], includeHistory: false });
      const type = f.activityTypeId ? snapshot.activityTypes.find(t => t.id === f.activityTypeId) : snapshot.activityTypes.find(t => t.name === "Other activity / note") ?? snapshot.activityTypes.find(t => t.channel === "note");
      if (!type) throw new GudActionError("Configure a note activity type before saving notes.");
      await logActivity(actor, { opportunityId: id, activityTypeId: type.id, notes: f.note, outcome: f.activityOutcome, occurredAt: f.occurredAt ? new Date(f.occurredAt) : new Date() });
    }
    const clearTargetOffer = f.clearOffer || (draft.kind === "target" && !draft.targetId && !f.offerId);
    if (f.researchThemeIds !== undefined || clearTargetOffer) {
      const [row] = await db.select({ metadata: opportunities.importMetadata }).from(opportunities).where(and(eq(opportunities.organisationId, actor.organisationId), eq(opportunities.id, id))).for("update");
      await db.update(opportunities).set({ ...(f.researchThemeIds !== undefined ? { importMetadata: { ...row.metadata, researchThemeIds: f.researchThemeIds } } : {}), ...(clearTargetOffer ? { offerId: null } : {}), updatedAt: new Date() }).where(and(eq(opportunities.organisationId, actor.organisationId), eq(opportunities.id, id)));
    }
    for (const taskId of f.completeTaskIds ?? []) await completeTask(actor, id, taskId);
    const stage = f.stageId ? (await actionReferences(actor)).stages.find(s => s.id === f.stageId) : null;
    return { href: recordHref({ kind: draft.kind === "target" && stage && !isResearchStage(stage) ? "lead" : draft.kind, id }), label: draft.label };
  }
  const target = draft.targetId ? await selected(actor, { kind: "project", id: draft.targetId }) : null;
  const delivery = deliveryDetails(target?.project?.delivery);
  if (f.value !== undefined) delivery.projectValue = f.value;
  if (f.stageId) delivery.stage = f.stageId;
  if (f.dueDate) delivery.dueDate = f.dueDate;
  if (f.nextMilestone !== undefined) delivery.nextMilestone = f.nextMilestone;
  if (f.note) delivery.notes = [delivery.notes, f.note].filter(Boolean).join("\n\n");
  if (f.task) delivery.tasks = [...delivery.tasks ?? [], { id: crypto.randomUUID(), text: f.task, completed: false }];
  if (f.addTasks) delivery.tasks = [...delivery.tasks ?? [], ...f.addTasks.map(text => ({ id: crypto.randomUUID(), text, completed: false }))];
  delivery.tasks = delivery.tasks?.map(t => ({ ...t, completed: t.completed || Boolean(f.completeTaskIds?.includes(t.id)) }));
  const id = draft.targetId ?? crypto.randomUUID();
  if (target?.project?.source === "sales") {
    await updateDelivery(actor, { opportunityId: id, delivery });
    if (f.offerId || f.ownerId) await updateOpportunity(actor, { opportunityId: id, offerId: f.offerId, ownerId: f.ownerId });
  } else await mutateLiveWorkspace(actor, { kind: "project", create: !draft.targetId, project: directProjectSchema.parse({ ...target?.project, id, title: f.title ?? target?.project?.title, companyName: f.company ?? target?.project?.companyName, ownerId: f.ownerId ?? target?.project?.ownerId ?? actor.id, offerId: f.offerId ?? target?.project?.offerId ?? null, delivery }) });
  return { href: recordHref({ kind: "project", id }), label: draft.label };
}
/** Approved drafts + receipt commit atomically. Repeating Save returns receipts, not duplicate records. */
export async function commitDrafts(actor: CurrentMember, input: unknown) {
  assertConversationActor(actor);
  const approvals = z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).min(1).max(8).parse(input);
  if (new Set(approvals.map(x => x.id)).size !== approvals.length) throw new GudActionError("A draft was selected twice.");
  return withDatabaseTransaction(async () => {
    await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, actor.organisationId)).for("update");
    const drafts: GudDraft[] = [];
    for (const item of approvals) {
      const draft = await ownedDraft(actor, item.id, true);
      if (draft.status !== "saved") {
        assertEditable(draft, item.version);
        await validate(actor, draft, true);
        if (draft.targetId && draft.kind === "thought" && String((await getThought(actor, draft.targetId)).version) !== draft.baseline) throw new GudActionError("This Thought changed since the draft was prepared. Cancel the draft and read it again; your newer edits are safe.");
        if (draft.targetId && draft.kind === "idea" && hash(await readIdea(actor, draft.targetId, true)) !== draft.baseline) throw new GudActionError("This idea changed since your draft was prepared. Read it again before saving.");
        if (draft.targetId && draft.kind !== "thought" && draft.kind !== "idea") {
          await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.organisationId, actor.organisationId), eq(opportunities.id, draft.targetId))).for("update");
          await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.organisationId, actor.organisationId), eq(tasks.opportunityId, draft.targetId))).for("update");
          const target = await selected(actor, { kind: draft.kind, id: draft.targetId });
          if (target.lead) {
            await db.select({ id: companies.id }).from(companies).where(and(eq(companies.organisationId, actor.organisationId), eq(companies.id, target.lead.company.id))).for("update");
            await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.organisationId, actor.organisationId), eq(contacts.companyId, target.lead.company.id))).for("update");
          }
          if (baseline(await selected(actor, { kind: draft.kind, id: draft.targetId })) !== draft.baseline) throw new GudActionError("A record changed since this draft was prepared. Cancel that draft and prepare it again so newer work is not overwritten.");
        }
      }
      drafts.push(draft);
    }
    const receipts = [];
    for (const draft of drafts) {
      const result = draft.status === "saved" ? draft.result! : await saveOne(actor, draft);
      if (draft.status !== "saved") await db.update(gudActionDrafts).set({ document: { ...draft, status: "saved", result, fields: {}, baseline: "" }, updatedAt: new Date() }).where(and(scope(actor), eq(gudActionDrafts.id, draft.id)));
      receipts.push({ draftId: draft.id, ...result });
    }
    return receipts;
  });
}
