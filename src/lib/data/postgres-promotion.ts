import { randomUUID } from "node:crypto";

import type { BoardSnapshot, PersonSummary } from "@/lib/domain/types";
import { normaliseName } from "@/lib/domain/normalise";

const organisationId = "00000000-0000-4000-8000-000000000001";

export type PromotionManifest = {
  edition: BoardSnapshot["edition"];
  users: number;
  companies: number;
  contacts: number;
  opportunities: number;
  activities: number;
  tasks: number;
  suggestions: number;
};

export function buildPostgresPromotionSql(snapshot: BoardSnapshot, input: {
  administratorEmail: string;
  organisationName: string;
  aiEnabled: boolean;
}) {
  const administratorEmail = input.administratorEmail.trim().toLowerCase();
  const administrator = snapshot.users.find((user) => user.email?.toLowerCase() === administratorEmail)
    ?? snapshot.users.find((user) => user.role === "admin")
    ?? snapshot.users[0];
  if (!administrator) throw new Error("The SQLite workspace has no administrator to map into PostgreSQL.");

  const companies = new Map(snapshot.opportunities.map((item) => [item.company.id, item.company]));
  const contacts = new Map(snapshot.opportunities.flatMap((item) => item.contacts.map((contact) => [contact.id, { contact, companyId: item.company.id }] as const)));
  const manifest: PromotionManifest = {
    edition: snapshot.edition,
    users: snapshot.users.length,
    companies: companies.size,
    contacts: contacts.size,
    opportunities: snapshot.opportunities.length,
    activities: snapshot.opportunities.reduce((sum, item) => sum + item.activities.length, 0),
    tasks: snapshot.opportunities.reduce((sum, item) => sum + item.tasks.length, 0),
    suggestions: snapshot.opportunities.reduce((sum, item) => sum + (item.aiSuggestions?.length ?? 0), 0),
  };

  const sql: string[] = [
    "-- GUD CRM private SQLite-to-PostgreSQL promotion",
    `-- Expected counts: ${JSON.stringify(manifest)}`,
    "BEGIN;",
    "SET LOCAL lock_timeout = '15s';",
    "SET LOCAL statement_timeout = '5min';",
    `DO $gud$ DECLARE existing_opportunities integer; BEGIN
      IF NOT EXISTS (SELECT 1 FROM organisations WHERE id = ${text(organisationId)}::uuid) THEN
        RAISE EXCEPTION 'Bootstrap organisation is missing; start the application once with GUD_BOOTSTRAP=if-empty.';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(${text(administratorEmail)}) AND organisation_id = ${text(organisationId)}::uuid AND active = true) THEN
        RAISE EXCEPTION 'Bootstrap administrator is missing or belongs to another workspace.';
      END IF;
      SELECT count(*) INTO existing_opportunities FROM opportunities WHERE organisation_id = ${text(organisationId)}::uuid;
      IF existing_opportunities <> 0 THEN
        RAISE EXCEPTION 'Target workspace is not empty (% opportunities); refusing promotion.', existing_opportunities;
      END IF;
    END $gud$;`,
    `UPDATE organisations SET name = ${text(input.organisationName)}, ai_enabled = ${bool(input.aiEnabled)}, settings = ${json({ edition: snapshot.edition })}, updated_at = now() WHERE id = ${text(organisationId)}::uuid;`,
    `UPDATE users SET name = ${text(administrator.name)}, role = 'admin', active = true, organisation_id = ${text(organisationId)}::uuid, updated_at = now() WHERE lower(email) = lower(${text(administratorEmail)});`,
  ];

  for (const user of snapshot.users) {
    if (!user.email || user.email.toLowerCase() === administratorEmail) continue;
    sql.push(`INSERT INTO users (id, name, email, email_verified, organisation_id, role, active, banned, created_at, updated_at)
      VALUES (${text(user.id)}, ${text(user.name)}, ${text(user.email.toLowerCase())}, false, ${text(organisationId)}::uuid, ${text(user.role ?? "member")}::user_role, ${bool(user.active !== false)}, false, now(), now())
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, organisation_id = EXCLUDED.organisation_id, role = EXCLUDED.role, active = EXCLUDED.active, updated_at = now();`);
  }

  sql.push(`INSERT INTO pipelines (id, organisation_id, name, active, created_at, updated_at)
    VALUES (${text(snapshot.pipeline.id)}::uuid, ${text(organisationId)}::uuid, ${text(snapshot.pipeline.name)}, true, now(), now())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now();`);

  for (const offer of snapshot.offers) {
    sql.push(`INSERT INTO offers (id, organisation_id, name, normalised_name, colour, description, ideal_customer, positioning, is_default, active, position, created_at, updated_at)
      VALUES (${text(offer.id)}::uuid, ${text(organisationId)}::uuid, ${text(offer.name)}, ${text(normaliseName(offer.name))}, ${text(offer.colour)}, ${text(offer.description)}, ${text(offer.idealCustomer)}, ${text(offer.positioning)}, ${bool(offer.isDefault)}, ${bool(offer.active)}, ${integer(offer.position)}, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, normalised_name = EXCLUDED.normalised_name, colour = EXCLUDED.colour, description = EXCLUDED.description, ideal_customer = EXCLUDED.ideal_customer, positioning = EXCLUDED.positioning, is_default = EXCLUDED.is_default, active = EXCLUDED.active, position = EXCLUDED.position, updated_at = now();`);
  }
  sql.push(`UPDATE offers SET active = false, updated_at = now() WHERE organisation_id = ${text(organisationId)}::uuid AND id NOT IN (${snapshot.offers.map((offer) => `${text(offer.id)}::uuid`).join(", ")});`);

  sql.push(`UPDATE stages SET position = position + 1000 WHERE pipeline_id = ${text(snapshot.pipeline.id)}::uuid;`);
  for (const stage of snapshot.stages) {
    sql.push(`INSERT INTO stages (id, pipeline_id, name, colour, position, terminal_type, active, created_at, updated_at)
      VALUES (${text(stage.id)}::uuid, ${text(snapshot.pipeline.id)}::uuid, ${text(stage.name)}, ${text(stage.colour)}, ${integer(stage.position)}, ${text(stage.terminalType)}::terminal_type, true, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, colour = EXCLUDED.colour, position = EXCLUDED.position, terminal_type = EXCLUDED.terminal_type, active = true, updated_at = now();`);
  }
  sql.push(`UPDATE stages SET active = false, updated_at = now() WHERE pipeline_id = ${text(snapshot.pipeline.id)}::uuid AND id NOT IN (${snapshot.stages.map((stage) => `${text(stage.id)}::uuid`).join(", ")});`);

  for (const type of snapshot.activityTypes) {
    sql.push(`INSERT INTO activity_types (id, organisation_id, name, channel, icon, colour, active, built_in, created_at, updated_at)
      VALUES (${text(type.id)}::uuid, ${text(organisationId)}::uuid, ${text(type.name)}, ${text(type.channel)}::activity_channel, ${text(type.icon)}, ${text(type.colour)}, true, true, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, channel = EXCLUDED.channel, icon = EXCLUDED.icon, colour = EXCLUDED.colour, active = true, updated_at = now();`);
  }
  sql.push(`UPDATE activity_types SET active = false, updated_at = now() WHERE organisation_id = ${text(organisationId)}::uuid AND id NOT IN (${snapshot.activityTypes.map((type) => `${text(type.id)}::uuid`).join(", ")});`);

  for (const company of companies.values()) {
    sql.push(`INSERT INTO companies (id, organisation_id, name, normalised_name, website_url, linkedin_url, scale_note, sector, fit_score, research_note, source_urls, do_not_contact, import_metadata, created_at, updated_at)
      VALUES (${text(company.id)}::uuid, ${text(organisationId)}::uuid, ${text(company.name)}, ${text(normaliseName(company.name))}, ${nullableText(company.websiteUrl)}, ${nullableText(company.linkedinUrl)}, ${nullableText(company.scaleNote)}, ${nullableText(company.sector)}, ${nullableInteger(company.fitScore)}, ${nullableText(company.researchNote)}, ${json(company.sourceUrls ?? [])}, ${bool(company.doNotContact)}, ${json({ promotedFrom: "sqlite" })}, now(), now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, normalised_name = EXCLUDED.normalised_name, website_url = EXCLUDED.website_url, linkedin_url = EXCLUDED.linkedin_url, scale_note = EXCLUDED.scale_note, sector = EXCLUDED.sector, fit_score = EXCLUDED.fit_score, research_note = EXCLUDED.research_note, source_urls = EXCLUDED.source_urls, do_not_contact = EXCLUDED.do_not_contact, import_metadata = EXCLUDED.import_metadata, updated_at = now();`);
  }

  for (const { contact, companyId } of contacts.values()) {
    sql.push(`INSERT INTO contacts (id, organisation_id, company_id, name, normalised_name, title, email, phone, linkedin_url, source_urls, preferred_channel, do_not_contact, import_metadata, created_at, updated_at)
      VALUES (${text(contact.id)}::uuid, ${text(organisationId)}::uuid, ${text(companyId)}::uuid, ${text(contact.name)}, ${text(normaliseName(contact.name))}, ${nullableText(contact.title)}, ${nullableText(contact.email?.toLowerCase() ?? null)}, ${nullableText(contact.phone)}, ${nullableText(contact.linkedinUrl)}, ${json(contact.sourceUrls ?? [])}, ${contact.preferredChannel ? `${text(contact.preferredChannel)}::activity_channel` : "NULL"}, ${bool(contact.doNotContact)}, ${json({ promotedFrom: "sqlite" })}, now(), now())
      ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, normalised_name = EXCLUDED.normalised_name, title = EXCLUDED.title, email = EXCLUDED.email, phone = EXCLUDED.phone, linkedin_url = EXCLUDED.linkedin_url, source_urls = EXCLUDED.source_urls, preferred_channel = EXCLUDED.preferred_channel, do_not_contact = EXCLUDED.do_not_contact, import_metadata = EXCLUDED.import_metadata, updated_at = now();`);
  }

  for (const opportunity of snapshot.opportunities) {
    sql.push(`INSERT INTO opportunities (id, organisation_id, pipeline_id, offer_id, company_id, stage_id, owner_id, title, priority, temperature, value, probability, expected_close_date, outreach_angle, last_activity_at, next_action_at, no_next_action_reason, import_metadata, created_at, updated_at)
      VALUES (${text(opportunity.id)}::uuid, ${text(organisationId)}::uuid, ${text(snapshot.pipeline.id)}::uuid, ${opportunity.offer ? `${text(opportunity.offer.id)}::uuid` : "NULL"}, ${text(opportunity.company.id)}::uuid, ${text(opportunity.stageId)}::uuid, ${ownerId(opportunity.owner, snapshot.users, administratorEmail)}, ${text(opportunity.title)}, ${text(opportunity.priority)}::priority, ${text(opportunity.temperature)}::temperature, ${nullableNumber(opportunity.expectedValue)}, ${nullableInteger(opportunity.probability)}, ${nullableTimestamp(opportunity.expectedCloseDate)}, ${nullableText(opportunity.outreachAngle)}, ${nullableTimestamp(opportunity.lastActivityAt)}, ${nullableTimestamp(opportunity.nextActionAt)}, ${nullableText(opportunity.noNextActionReason)}, ${json({ promotedFrom: "sqlite", demoExample: opportunity.isExample === true })}, now(), now())
      ON CONFLICT (id) DO UPDATE SET offer_id = EXCLUDED.offer_id, company_id = EXCLUDED.company_id, stage_id = EXCLUDED.stage_id, owner_id = EXCLUDED.owner_id, title = EXCLUDED.title, priority = EXCLUDED.priority, temperature = EXCLUDED.temperature, value = EXCLUDED.value, probability = EXCLUDED.probability, expected_close_date = EXCLUDED.expected_close_date, outreach_angle = EXCLUDED.outreach_angle, last_activity_at = EXCLUDED.last_activity_at, next_action_at = EXCLUDED.next_action_at, no_next_action_reason = EXCLUDED.no_next_action_reason, import_metadata = EXCLUDED.import_metadata, updated_at = now();`);

    for (const contact of opportunity.contacts) {
      sql.push(`INSERT INTO opportunity_contacts (opportunity_id, contact_id, "primary", created_at) VALUES (${text(opportunity.id)}::uuid, ${text(contact.id)}::uuid, ${bool(contact.primary)}, now()) ON CONFLICT (opportunity_id, contact_id) DO UPDATE SET "primary" = EXCLUDED."primary";`);
    }
    for (const activity of opportunity.activities) {
      sql.push(`INSERT INTO activities (id, organisation_id, opportunity_id, company_id, contact_id, activity_type_id, outcome, notes, metadata, occurred_at, created_at, created_by_id, updated_at)
        VALUES (${text(activity.id)}::uuid, ${text(organisationId)}::uuid, ${text(opportunity.id)}::uuid, ${text(opportunity.company.id)}::uuid, ${activity.contactId ? `${text(activity.contactId)}::uuid` : "NULL"}, ${text(activity.type.id)}::uuid, ${nullableText(activity.outcome)}, ${nullableText(activity.notes)}, ${json({ promotedFrom: "sqlite" })}, ${timestamp(activity.occurredAt)}, ${timestamp(activity.createdAt)}, ${adminId(administratorEmail)}, now()) ON CONFLICT (id) DO NOTHING;`);
    }
    for (const task of opportunity.tasks) {
      sql.push(`INSERT INTO tasks (id, organisation_id, opportunity_id, contact_id, owner_id, title, due_at, status, source, created_at, updated_at)
        VALUES (${text(task.id)}::uuid, ${text(organisationId)}::uuid, ${text(opportunity.id)}::uuid, ${task.contactId ? `${text(task.contactId)}::uuid` : "NULL"}, ${ownerId(task.owner, snapshot.users, administratorEmail)}, ${text(task.title)}, ${timestamp(task.dueAt)}, ${text(task.status)}::task_status, 'sqlite-promotion', now(), now()) ON CONFLICT (id) DO NOTHING;`);
    }
    for (const suggestion of opportunity.aiSuggestions ?? []) {
      sql.push(`INSERT INTO ai_suggestions (id, organisation_id, opportunity_id, suggestion_type, output, context_references, provider, model, prompt_version, input_tokens, output_tokens, generated_by_id, generated_at)
        VALUES (${text(suggestion.id)}::uuid, ${text(organisationId)}::uuid, ${text(opportunity.id)}::uuid, ${text(suggestion.suggestionType)}, ${json(suggestion.output)}, ${json(suggestion.contextReferences)}, ${text(suggestion.provider)}, ${text(suggestion.model)}, ${text(suggestion.promptVersion)}, ${nullableInteger(suggestion.inputTokens)}, ${nullableInteger(suggestion.outputTokens)}, ${adminId(administratorEmail)}, ${timestamp(suggestion.generatedAt)}) ON CONFLICT (id) DO NOTHING;`);
      if (suggestion.feedbackRating) {
        sql.push(`INSERT INTO ai_feedback (id, suggestion_id, user_id, rating, created_at) VALUES (${text(randomUUID())}::uuid, ${text(suggestion.id)}::uuid, ${adminId(administratorEmail)}, ${text(suggestion.feedbackRating)}::ai_feedback_rating, now()) ON CONFLICT (suggestion_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = now();`);
      }
    }
  }

  sql.push(
    `INSERT INTO audit_events (id, organisation_id, actor_id, action, entity_type, entity_id, after, created_at) VALUES (${text(randomUUID())}::uuid, ${text(organisationId)}::uuid, ${adminId(administratorEmail)}, 'workspace.promoted_from_sqlite', 'workspace', ${text(organisationId)}, ${json(manifest)}, now());`,
    `SELECT
      (SELECT count(*) FROM companies WHERE organisation_id = ${text(organisationId)}::uuid) AS companies,
      (SELECT count(*) FROM contacts WHERE organisation_id = ${text(organisationId)}::uuid) AS contacts,
      (SELECT count(*) FROM opportunities WHERE organisation_id = ${text(organisationId)}::uuid) AS opportunities,
      (SELECT count(*) FROM activities WHERE organisation_id = ${text(organisationId)}::uuid) AS activities,
      (SELECT count(*) FROM tasks WHERE organisation_id = ${text(organisationId)}::uuid) AS tasks,
      (SELECT count(*) FROM ai_suggestions WHERE organisation_id = ${text(organisationId)}::uuid) AS suggestions;`,
    "COMMIT;",
    "",
  );

  return { sql: sql.join("\n"), manifest };
}

function adminId(email: string) {
  return `(SELECT id FROM users WHERE lower(email) = lower(${text(email)}) AND organisation_id = ${text(organisationId)}::uuid)`;
}

function ownerId(owner: PersonSummary | null, users: PersonSummary[], administratorEmail: string) {
  const email = owner?.email ?? users.find((user) => user.id === owner?.id)?.email;
  return email ? `(SELECT id FROM users WHERE lower(email) = lower(${text(email.toLowerCase())}) AND organisation_id = ${text(organisationId)}::uuid)` : adminId(administratorEmail);
}

function text(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function nullableText(value: string | null | undefined) {
  return value === null || value === undefined || value === "" ? "NULL" : text(value);
}

function json(value: unknown) {
  return `${text(JSON.stringify(value))}::jsonb`;
}

function bool(value: boolean) {
  return value ? "true" : "false";
}

function integer(value: number) {
  if (!Number.isInteger(value)) throw new Error(`Expected an integer, received ${value}.`);
  return String(value);
}

function nullableInteger(value: number | null | undefined) {
  return value === null || value === undefined ? "NULL" : integer(value);
}

function nullableNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (!Number.isFinite(value)) throw new Error(`Expected a finite number, received ${value}.`);
  return String(value);
}

function timestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid timestamp: ${value}.`);
  return `${text(parsed.toISOString())}::timestamptz`;
}

function nullableTimestamp(value: string | null | undefined) {
  return value ? timestamp(value) : "NULL";
}
