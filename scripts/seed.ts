import "./load-env";

import { and, count, eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import {
  activities,
  activityTypes,
  companies,
  contacts,
  offers,
  opportunities,
  opportunityContacts,
  organisations,
  pipelines,
  researchThemes,
  stages,
  tasks,
  users,
} from "../src/db/schema";
import { createInitialSnapshot } from "../src/lib/editions/bootstrap";
import { getEdition, normaliseEditionKey } from "../src/lib/editions";
import { normaliseName } from "../src/lib/domain/normalise";
import { env } from "../src/lib/env";
import { auth } from "../src/lib/auth";

const organisationId = "00000000-0000-4000-8000-000000000001";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for seeding. Demo mode does not need a seed.");
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const [existingOrganisation] = await db.select({ name: organisations.name, settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1);
  if (existingOrganisation && process.env.SEED_ALLOW_EXISTING !== "true") {
    if (process.env.SEED_IF_EMPTY === "true") {
      const [[existingAdmin], [existingPipeline], [existingStage], [existingActivityType], [existingOffer]] = await Promise.all([
        db.select({ id: users.id, organisationId: users.organisationId }).from(users).where(eq(users.email, email)).limit(1),
        db.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.organisationId, organisationId), eq(pipelines.active, true))).limit(1),
        db.select({ id: stages.id }).from(stages).limit(1),
        db.select({ id: activityTypes.id }).from(activityTypes).where(and(eq(activityTypes.organisationId, organisationId), eq(activityTypes.active, true))).limit(1),
        db.select({ id: offers.id }).from(offers).where(and(eq(offers.organisationId, organisationId), eq(offers.active, true))).limit(1),
      ]);
      if (existingAdmin?.organisationId === organisationId && existingPipeline && existingStage && existingActivityType && existingOffer) {
        console.log(`PostgreSQL workspace is already bootstrapped for ${email}; no seed changes were applied.`);
        return;
      }
      console.log("An incomplete bootstrap was detected; repairing the existing workspace.");
    } else {
      throw new Error("Refusing to seed an existing organisation. Set SEED_ALLOW_EXISTING=true only for an intentional fixture refresh.");
    }
  }
  const editionKey = existingOrganisation ? normaliseEditionKey(existingOrganisation.settings.edition) : env.defaultEdition;
  const seedBoard = loadFixture() ?? createInitialSnapshot(editionKey, "postgres");
  if (seedBoard.edition !== editionKey) throw new Error(`The private seed fixture is for ${seedBoard.edition}, but this deployment is configured for ${editionKey}.`);
  const edition = getEdition(seedBoard.edition);
  const organisationName = existingOrganisation?.name ?? process.env.SEED_ORGANISATION_NAME ?? edition.name;

  await db
    .insert(organisations)
    .values({ id: organisationId, name: organisationName, settings: { edition: edition.key } })
    .onConflictDoUpdate({ target: organisations.id, set: { updatedAt: new Date() } });

  const adminName = process.env.SEED_ADMIN_NAME ?? "Workspace Admin";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD is required and must contain at least 12 characters.");
  }
  let [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!admin) {
    await auth.api.createUser({
      body: {
        name: adminName,
        email,
        password,
        role: "admin",
        data: { organisationId, active: true },
      },
    });
    [admin] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  }
  if (!admin) throw new Error("The seed admin could not be created.");

  await db
    .update(users)
    .set({ organisationId, role: "admin", active: true, updatedAt: new Date() })
    .where(eq(users.id, admin.id));
  for (const teammate of existingOrganisation ? [] : seedBoard.users.slice(1)) {
    await db
      .insert(users)
      .values({ id: teammate.id, name: teammate.name, email: teammate.email!, role: teammate.role ?? "member", organisationId, emailVerified: false })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: teammate.name, email: teammate.email!, role: teammate.role ?? "member", organisationId, active: true, updatedAt: new Date() },
      });
  }

  await db
    .insert(pipelines)
    .values({ id: seedBoard.pipeline.id, organisationId, name: seedBoard.pipeline.name })
    .onConflictDoUpdate({ target: pipelines.id, set: { name: seedBoard.pipeline.name, active: true, updatedAt: new Date() } });
  const offerIds = new Map<string, string>();
  for (const offer of seedBoard.offers) {
    const [storedOffer] = await db.insert(offers).values({
      ...offer,
      organisationId,
      normalisedName: normaliseName(offer.name),
    }).onConflictDoUpdate({
      target: [offers.organisationId, offers.normalisedName],
      set: {
        name: offer.name,
        normalisedName: normaliseName(offer.name),
        colour: offer.colour,
        description: offer.description,
        idealCustomer: offer.idealCustomer,
        positioning: offer.positioning,
        isDefault: offer.isDefault,
        active: offer.active,
        position: offer.position,
        updatedAt: new Date(),
      },
    }).returning({ id: offers.id });
    offerIds.set(offer.id, storedOffer.id);
  }
  await db
    .update(opportunities)
    .set({ stageId: "10000000-0000-4000-8000-000000000003", updatedAt: new Date() })
    .where(eq(opportunities.stageId, "10000000-0000-4000-8000-000000000004"));
  await db
    .update(stages)
    .set({ name: "Legacy outbound asset (retired)", position: 99, active: false, updatedAt: new Date() })
    .where(eq(stages.id, "10000000-0000-4000-8000-000000000004"));
  await db
    .update(stages)
    .set({ position: sql`${stages.position} + 100` })
    .where(eq(stages.pipelineId, seedBoard.pipeline.id));
  for (const stage of seedBoard.stages) {
    await db
      .insert(stages)
      .values({
        ...stage,
        pipelineId: seedBoard.pipeline.id,
      })
      .onConflictDoUpdate({
        target: stages.id,
        set: {
          name: stage.name,
          colour: stage.colour,
          position: stage.position,
          terminalType: stage.terminalType,
          active: true,
          updatedAt: new Date(),
        },
      });
  }
  for (const type of seedBoard.activityTypes) {
    await db
      .insert(activityTypes)
      .values({ ...type, organisationId, builtIn: true })
      .onConflictDoUpdate({
        target: activityTypes.id,
        set: { name: type.name, channel: type.channel, icon: type.icon, colour: type.colour, active: true, updatedAt: new Date() },
      });
  }

  const ownerIds = new Map(seedBoard.users.map((user, index) => [user.name, existingOrganisation || index === 0 ? admin.id : user.id]));
  const uniqueCompanies = new Map(seedBoard.opportunities.map((item) => [item.company.id, item.company]));
  for (const company of uniqueCompanies.values()) {
    await db
      .insert(companies)
      .values({
        ...company,
        archivedAt: company.archivedAt ? new Date(company.archivedAt) : null,
        organisationId,
        normalisedName: normaliseName(company.name),
      })
      .onConflictDoUpdate({
        target: companies.id,
        set: { name: company.name, sector: company.sector, websiteUrl: company.websiteUrl, linkedinUrl: company.linkedinUrl, fitScore: company.fitScore, scaleNote: company.scaleNote, archivedAt: company.archivedAt ? new Date(company.archivedAt) : null, updatedAt: new Date() },
      });
  }

  const uniqueContacts = new Map(
    seedBoard.opportunities.flatMap((item) => item.contacts.map((contact) => [contact.id, { contact, companyId: item.company.id }] as const)),
  );
  for (const { contact, companyId } of uniqueContacts.values()) {
    await db
      .insert(contacts)
      .values({
        id: contact.id,
        organisationId,
        companyId,
        name: contact.name,
        normalisedName: normaliseName(contact.name),
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
        linkedinUrl: contact.linkedinUrl,
      })
      .onConflictDoUpdate({
        target: contacts.id,
        set: { title: contact.title, email: contact.email, phone: contact.phone, linkedinUrl: contact.linkedinUrl, updatedAt: new Date() },
      });
  }

  for (const opportunity of seedBoard.opportunities) {
    await db
      .insert(opportunities)
      .values({
        id: opportunity.id,
        organisationId,
        pipelineId: seedBoard.pipeline.id,
        offerId: opportunity.offer ? offerIds.get(opportunity.offer.id) ?? null : null,
        companyId: opportunity.company.id,
        stageId: opportunity.stageId,
        position: opportunity.position,
        ownerId: ownerIds.get(opportunity.owner?.name ?? "") ?? admin.id,
        title: opportunity.title,
        priority: opportunity.priority,
        temperature: opportunity.temperature,
        value: opportunity.expectedValue === null || opportunity.expectedValue === undefined ? null : String(opportunity.expectedValue),
        probability: opportunity.probability ?? null,
        expectedCloseDate: opportunity.expectedCloseDate ? new Date(opportunity.expectedCloseDate) : null,
        outreachAngle: opportunity.outreachAngle,
        lastActivityAt: opportunity.lastActivityAt ? new Date(opportunity.lastActivityAt) : null,
        nextActionAt: opportunity.nextActionAt ? new Date(opportunity.nextActionAt) : null,
        noNextActionReason: opportunity.noNextActionReason,
        archivedAt: opportunity.archivedAt ? new Date(opportunity.archivedAt) : null,
        importMetadata: { demoExample: opportunity.isExample === true },
      })
      .onConflictDoUpdate({
        target: opportunities.id,
        set: {
          stageId: opportunity.stageId,
          position: opportunity.position,
          offerId: opportunity.offer ? offerIds.get(opportunity.offer.id) ?? null : null,
          title: opportunity.title,
          priority: opportunity.priority,
          temperature: opportunity.temperature,
          value: opportunity.expectedValue === null || opportunity.expectedValue === undefined ? null : String(opportunity.expectedValue),
          probability: opportunity.probability ?? null,
          expectedCloseDate: opportunity.expectedCloseDate ? new Date(opportunity.expectedCloseDate) : null,
          outreachAngle: opportunity.outreachAngle,
          archivedAt: opportunity.archivedAt ? new Date(opportunity.archivedAt) : null,
          importMetadata: { demoExample: opportunity.isExample === true },
          updatedAt: new Date(),
        },
      });

    for (const contact of opportunity.contacts) {
      await db
        .insert(opportunityContacts)
        .values({ opportunityId: opportunity.id, contactId: contact.id, primary: contact.primary })
        .onConflictDoNothing();
    }
    for (const activity of opportunity.activities) {
      await db
        .insert(activities)
        .values({
          id: activity.id,
          organisationId,
          opportunityId: opportunity.id,
          companyId: opportunity.company.id,
          contactId: activity.contactId,
          activityTypeId: activity.type.id,
          outcome: activity.outcome,
          notes: activity.notes,
          occurredAt: new Date(activity.occurredAt),
          createdAt: new Date(activity.createdAt),
          createdById: admin.id,
        })
        .onConflictDoNothing();
    }
    for (const task of opportunity.tasks) {
      const ownerId = ownerIds.get(task.owner?.name ?? "") ?? admin.id;
      await db
        .insert(tasks)
        .values({
          id: task.id,
          organisationId,
          opportunityId: opportunity.id,
          contactId: task.contactId,
          ownerId,
          title: task.title,
          dueAt: new Date(task.dueAt),
          status: task.status,
          source: "seed",
        })
        .onConflictDoNothing();
    }
  }

  for (const [index, theme] of seedBoard.researchThemes.entries()) {
    await db
      .insert(researchThemes)
      .values({
        id: theme.id,
        organisationId,
        offerId: theme.offerId ? offerIds.get(theme.offerId) ?? null : null,
        ownerId: admin.id,
        title: theme.title,
        audience: theme.audience,
        problem: theme.problem,
        signal: theme.signal,
        angle: theme.angle,
        status: theme.status,
        position: theme.position ?? (index + 1) * 1000,
        sourceUrls: theme.sourceUrls,
        updatedAt: new Date(theme.updatedAt),
      })
      .onConflictDoUpdate({
        target: researchThemes.id,
        set: { title: theme.title, audience: theme.audience, problem: theme.problem, signal: theme.signal, angle: theme.angle, status: theme.status, position: theme.position ?? (index + 1) * 1000, sourceUrls: theme.sourceUrls, updatedAt: new Date(theme.updatedAt) },
      });
  }

  const [{ opportunityCount }] = await db
    .select({ opportunityCount: count() })
    .from(opportunities)
    .where(and(eq(opportunities.organisationId, organisationId), eq(opportunities.pipelineId, seedBoard.pipeline.id)));
  console.log(`Seed complete for ${email}. ${opportunityCount} opportunities are available in PostgreSQL.`);
}

function loadFixture() {
  const encoded = process.env.SEED_FIXTURE_BASE64?.trim();
  if (!encoded) return null;
  const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ReturnType<typeof createInitialSnapshot>;
  if (!parsed || !Array.isArray(parsed.stages) || !Array.isArray(parsed.opportunities) || !Array.isArray(parsed.researchThemes)) throw new Error("SEED_FIXTURE_BASE64 is not a valid GUD workspace fixture.");
  return parsed;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
