import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { and, eq, isNull } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import { db } from "@/db";
import {
  companies,
  contacts,
  importRows,
  imports,
  opportunities,
  offers,
  opportunityContacts,
  pipelines,
  stages,
  tasks,
} from "@/db/schema";
import { extractDomain, isSafeHttpUrl, normaliseName } from "@/lib/domain/normalise";
import { getLocalSetting, setLocalSetting, updateLocalBoardSnapshot } from "@/lib/data/local-store";
import type { ContactSummary } from "@/lib/domain/types";

export { extractDomain, normaliseName } from "@/lib/domain/normalise";

const optionalHttpUrl = z.string().trim().max(2_000).refine(
  (value) => !value || isSafeHttpUrl(value),
  "Links must use HTTP or HTTPS",
);

const httpUrlList = z.string().max(20_000).refine(
  (value) => !value || value.split(/\s*;\s*/).filter(Boolean).every(isSafeHttpUrl),
  "Source links must use HTTP or HTTPS",
);

const expectedHeaders = [
  "Source Para",
  "Category",
  "Company",
  "Initial Store Count / Scale Note",
  "Initial Priority",
  "Initial Fit Score",
  "Priority Reason",
  "Ideal Buyer Roles",
  "Outreach Angle",
  "Website URL",
  "LinkedIn Company URL",
  "LinkedIn People Search URL",
  "Contact 1 Name",
  "Contact 1 Title",
  "Contact 1 LinkedIn URL",
  "Contact 2 Name",
  "Contact 2 Title",
  "Contact 2 LinkedIn URL",
  "Source URL(s)",
  "Research Status",
  "Outreach Status",
  "Next Action",
  "Notes",
] as const;

const trackerRowSchema = z.object({
  sourceRow: z.number().int().positive(),
  sourcePara: z.number().int().nullable(),
  category: z.string(),
  company: z.string().trim().min(1, "Company is required"),
  scaleNote: z.string(),
  initialPriority: z.string(),
  fitScore: z.number().int().min(1).max(5).nullable(),
  priorityReason: z.string(),
  idealBuyerRoles: z.string(),
  outreachAngle: z.string(),
  websiteUrl: optionalHttpUrl,
  linkedinCompanyUrl: optionalHttpUrl,
  linkedinPeopleSearchUrl: optionalHttpUrl,
  contact1Name: z.string(),
  contact1Title: z.string(),
  contact1LinkedinUrl: optionalHttpUrl,
  contact2Name: z.string(),
  contact2Title: z.string(),
  contact2LinkedinUrl: optionalHttpUrl,
  sourceUrls: httpUrlList,
  researchStatus: z.string(),
  outreachStatus: z.string(),
  nextAction: z.string(),
  notes: z.string(),
  raw: z.record(z.string(), z.string()),
});

export type ParsedTrackerRow = z.infer<typeof trackerRowSchema>;

export type ImportPreviewRow = {
  sourceRow: number;
  company: string;
  key: string;
  action: "create" | "duplicate_source" | "invalid";
  stage: string;
  contacts: number;
  errors: string[];
  row: ParsedTrackerRow | null;
};

export type ImportPreview = {
  fileName: string;
  checksum: string;
  totalRows: number;
  creates: number;
  duplicateSourceRows: number;
  invalidRows: number;
  companies: number;
  contacts: number;
  rows: ImportPreviewRow[];
};

export type TrackerImportReport = {
  rowsProcessed: number;
  invalidRows: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  opportunitiesCreated: number;
  tasksCreated: number;
};

export async function previewTrackerImport(filePath: string): Promise<ImportPreview> {
  const bytes = await readFile(filePath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const sheetRows = readOoxmlSheet(bytes, "Target Tracker");
  if (!sheetRows.length) throw new Error('The workbook does not contain data in the "Target Tracker" sheet.');

  const headerMap = new Map<string, number>();
  sheetRows[0].forEach((cell, column) => headerMap.set(cellText(cell), column));
  const missing = expectedHeaders.filter((header) => !headerMap.has(header));
  if (missing.length) throw new Error(`Tracker is missing required columns: ${missing.join(", ")}`);

  const seenCompanies = new Set<string>();
  const rows: ImportPreviewRow[] = [];
  const companyKeys = new Set<string>();
  let contactCount = 0;

  for (let sourceRow = 2; sourceRow <= sheetRows.length; sourceRow += 1) {
    const excelRow = sheetRows[sourceRow - 1];
    const raw = Object.fromEntries(
      expectedHeaders.map((header) => [header, cellText(excelRow[headerMap.get(header)!])]),
    );
    if (!raw.Company) continue;

    const candidate = {
      sourceRow,
      sourcePara: integerOrNull(raw["Source Para"]),
      category: raw.Category,
      company: raw.Company,
      scaleNote: raw["Initial Store Count / Scale Note"],
      initialPriority: raw["Initial Priority"],
      fitScore: integerOrNull(raw["Initial Fit Score"]),
      priorityReason: raw["Priority Reason"],
      idealBuyerRoles: raw["Ideal Buyer Roles"],
      outreachAngle: raw["Outreach Angle"],
      websiteUrl: raw["Website URL"],
      linkedinCompanyUrl: raw["LinkedIn Company URL"],
      linkedinPeopleSearchUrl: raw["LinkedIn People Search URL"],
      contact1Name: raw["Contact 1 Name"],
      contact1Title: raw["Contact 1 Title"],
      contact1LinkedinUrl: raw["Contact 1 LinkedIn URL"],
      contact2Name: raw["Contact 2 Name"],
      contact2Title: raw["Contact 2 Title"],
      contact2LinkedinUrl: raw["Contact 2 LinkedIn URL"],
      sourceUrls: raw["Source URL(s)"],
      researchStatus: raw["Research Status"],
      outreachStatus: raw["Outreach Status"],
      nextAction: raw["Next Action"],
      notes: raw.Notes,
      raw,
    };
    const parsed = trackerRowSchema.safeParse(candidate);
    if (!parsed.success) {
      rows.push({
        sourceRow,
        company: raw.Company,
        key: normaliseName(raw.Company),
        action: "invalid",
        stage: "Researching",
        contacts: 0,
        errors: parsed.error.issues.map((issue) => issue.message),
        row: null,
      });
      continue;
    }

    const key = companyKey(parsed.data.websiteUrl, parsed.data.company);
    const duplicate = seenCompanies.has(key);
    seenCompanies.add(key);
    companyKeys.add(key);
    const contactsInRow = Number(Boolean(parsed.data.contact1Name)) + Number(Boolean(parsed.data.contact2Name));
    contactCount += contactsInRow;
    rows.push({
      sourceRow,
      company: parsed.data.company,
      key,
      action: duplicate ? "duplicate_source" : "create",
      stage: mapTrackerStage(parsed.data.outreachStatus, parsed.data.researchStatus),
      contacts: contactsInRow,
      errors: [],
      row: parsed.data,
    });
  }

  return {
    fileName: filePath.split(/[\\/]/).at(-1) ?? filePath,
    checksum,
    totalRows: rows.length,
    creates: rows.filter((row) => row.action === "create").length,
    duplicateSourceRows: rows.filter((row) => row.action === "duplicate_source").length,
    invalidRows: rows.filter((row) => row.action === "invalid").length,
    companies: companyKeys.size,
    contacts: contactCount,
    rows,
  };
}

export function commitTrackerImportToLocal(preview: ImportPreview, createdById = "demo-alex") {
  const settingKey = `tracker_import:${preview.checksum}`;
  const previous = getLocalSetting<{ importId: string; report: TrackerImportReport }>(settingKey);
  if (previous) return { ...previous, alreadyCommitted: true };

  const importId = crypto.randomUUID();
  const report = updateLocalBoardSnapshot((snapshot): TrackerImportReport => {
    let companiesCreated = 0;
    let companiesUpdated = 0;
    let contactsCreated = 0;
    let opportunitiesCreated = 0;
    let tasksCreated = 0;
    const owner = snapshot.users.find((user) => user.id === createdById) ?? snapshot.users[0] ?? null;
    const stageByName = new Map(snapshot.stages.map((stage) => [stage.name, stage]));
    const fallbackStage = stageByName.get("Researching") ?? snapshot.stages[0];
    if (!fallbackStage) throw new Error("Create pipeline stages before committing the tracker import.");
    const activeOffers = snapshot.offers.filter((offer) => offer.active);
    const importOffer = activeOffers.length === 1 ? activeOffers[0] : null;

    for (const previewRow of preview.rows) {
      if (!previewRow.row) continue;
      const row = previewRow.row;
      const key = companyKey(row.websiteUrl, row.company);
      let opportunity = snapshot.opportunities.find((item) =>
        companyKey(item.company.websiteUrl ?? "", item.company.name) === key &&
        (importOffer ? item.offer?.id === importOffer.id : activeOffers.length > 1 ? !item.offer : true),
      );
      if (!opportunity) {
        const companyId = crypto.randomUUID();
        const stage = importOffer ? stageByName.get(mapTrackerStage(row.outreachStatus, row.researchStatus)) ?? fallbackStage : fallbackStage;
        opportunity = {
          id: crypto.randomUUID(),
          stageId: stage.id,
          position: Math.max(0, ...snapshot.opportunities.filter((item) => item.stageId === stage.id).map((item) => item.position)) + 1000,
          offer: importOffer,
          company: {
            id: companyId,
            name: row.company,
            sector: valueOrNull(row.category),
            websiteUrl: valueOrNull(row.websiteUrl),
            linkedinUrl: valueOrNull(row.linkedinCompanyUrl),
            fitScore: row.fitScore,
            scaleNote: valueOrNull(row.scaleNote),
            doNotContact: false,
            researchNote: valueOrNull([row.priorityReason, row.notes].filter(Boolean).join("\n\n")),
            sourceUrls: splitUrls(row.sourceUrls),
            linkedinPeopleSearchUrl: valueOrNull(row.linkedinPeopleSearchUrl),
            idealBuyerRoles: valueOrNull(row.idealBuyerRoles),
            priorityReason: valueOrNull(row.priorityReason),
          },
          title: `${row.company} outreach`,
          priority: mapPriority(row.initialPriority, row.fitScore),
          temperature: "cold",
          owner,
          outreachAngle: valueOrNull(row.outreachAngle),
          lastActivityAt: null,
          nextActionAt: null,
          noNextActionReason: null,
          contacts: [],
          activities: [],
          tasks: [],
          recentChannels: [],
          aiSuggestions: [],
        };
        snapshot.opportunities.push(opportunity);
        companiesCreated += 1;
        opportunitiesCreated += 1;
      } else {
        const company = opportunity.company;
        company.sector ||= valueOrNull(row.category);
        company.websiteUrl ||= valueOrNull(row.websiteUrl);
        company.linkedinUrl ||= valueOrNull(row.linkedinCompanyUrl);
        company.fitScore ??= row.fitScore;
        company.scaleNote ||= valueOrNull(row.scaleNote);
        company.researchNote = mergeText(company.researchNote, row.priorityReason, row.notes);
        company.sourceUrls = [...new Set([...(company.sourceUrls ?? []), ...splitUrls(row.sourceUrls)])];
        company.linkedinPeopleSearchUrl ||= valueOrNull(row.linkedinPeopleSearchUrl);
        company.idealBuyerRoles ||= valueOrNull(row.idealBuyerRoles);
        company.priorityReason ||= valueOrNull(row.priorityReason);
        opportunity.outreachAngle ||= valueOrNull(row.outreachAngle);
        const mappedStage = stageByName.get(mapTrackerStage(row.outreachStatus, row.researchStatus));
        const currentStageId = opportunity.stageId;
        const currentStage = snapshot.stages.find((stage) => stage.id === currentStageId);
        if (
          mappedStage &&
          opportunity.activities.length === 0 &&
          (!currentStage ||
            mappedStage.terminalType !== "open" ||
            (currentStage.terminalType === "open" && mappedStage.position > currentStage.position))
        ) {
          opportunity.stageId = mappedStage.id;
        }
        companiesUpdated += 1;
      }

      const candidates = [
        { name: row.contact1Name, title: row.contact1Title, linkedinUrl: row.contact1LinkedinUrl, primary: true },
        { name: row.contact2Name, title: row.contact2Title, linkedinUrl: row.contact2LinkedinUrl, primary: false },
      ];
      for (const candidate of candidates) {
        if (!candidate.name) continue;
        const contactKey = normaliseName(candidate.name);
        const existing = opportunity.contacts.find((contact) =>
          (candidate.linkedinUrl && contact.linkedinUrl === candidate.linkedinUrl) || normaliseName(contact.name) === contactKey,
        );
        if (existing) {
          existing.title ||= valueOrNull(candidate.title);
          existing.linkedinUrl ||= valueOrNull(candidate.linkedinUrl);
          existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? []), ...splitUrls(row.sourceUrls)])];
          continue;
        }
        const contact: ContactSummary = {
          id: crypto.randomUUID(),
          name: candidate.name,
          title: valueOrNull(candidate.title),
          email: null,
          phone: null,
          linkedinUrl: valueOrNull(candidate.linkedinUrl),
          primary: candidate.primary && !opportunity.contacts.some((item) => item.primary),
          preferredChannel: "linkedin",
          doNotContact: false,
          sourceUrls: splitUrls(row.sourceUrls),
        };
        opportunity.contacts.push(contact);
        contactsCreated += 1;
      }

      const stage = snapshot.stages.find((item) => item.id === opportunity.stageId);
      if (row.nextAction && isActionable(row.nextAction) && !["Lost", "Nurture", "Research holding"].includes(stage?.name ?? "")) {
        const title = row.nextAction.slice(0, 240);
        if (!opportunity.tasks.some((task) => task.status === "open" && task.title === title)) {
          const dueAt = new Date();
          dueAt.setDate(dueAt.getDate() + 3);
          opportunity.tasks.push({ id: crypto.randomUUID(), title, dueAt: dueAt.toISOString(), status: "open", owner, contactId: opportunity.contacts.find((item) => item.primary)?.id ?? null });
          opportunity.nextActionAt = dueAt.toISOString();
          tasksCreated += 1;
        }
      }
    }

    return {
      rowsProcessed: preview.rows.length,
      invalidRows: preview.invalidRows,
      companiesCreated,
      companiesUpdated,
      contactsCreated,
      opportunitiesCreated,
      tasksCreated,
    };
  });
  const record = { importId, report };
  setLocalSetting(settingKey, record);
  return { ...record, alreadyCommitted: false };
}

export async function commitTrackerImport(
  preview: ImportPreview,
  organisationId: string,
  createdById?: string,
) {
  const previous = await db
    .select({ id: imports.id, report: imports.report })
    .from(imports)
    .where(
      and(
        eq(imports.organisationId, organisationId),
        eq(imports.checksum, preview.checksum),
        eq(imports.status, "committed"),
      ),
    )
    .limit(1);
  if (previous[0]) return { importId: previous[0].id, alreadyCommitted: true, report: previous[0].report };

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.organisationId, organisationId), eq(pipelines.active, true)))
    .limit(1);
  if (!pipeline) throw new Error("Create an active pipeline before committing the tracker import.");

  const offerRows = await db.select({ id: offers.id }).from(offers).where(and(
    eq(offers.organisationId, organisationId),
    eq(offers.active, true),
  ));
  const importOfferId = offerRows.length === 1 ? offerRows[0].id : null;

  const stageRows = await db.select().from(stages).where(eq(stages.pipelineId, pipeline.id));
  const stageByName = new Map(stageRows.map((stage) => [stage.name, stage]));
  const fallbackStage = stageByName.get("Researching") ?? stageRows[0];
  if (!fallbackStage) throw new Error("Create pipeline stages before committing the tracker import.");

  const report = await db.transaction(async (tx) => {
    const [importRecord] = await tx
      .insert(imports)
      .values({
        organisationId,
        fileName: preview.fileName,
        checksum: preview.checksum,
        status: "previewed",
        createdById,
        report: {
          totalRows: preview.totalRows,
          companies: preview.companies,
          contacts: preview.contacts,
          invalidRows: preview.invalidRows,
        },
      })
      .returning({ id: imports.id });

    let companiesCreated = 0;
    let companiesUpdated = 0;
    let contactsCreated = 0;
    let opportunitiesCreated = 0;
    let tasksCreated = 0;

    for (const previewRow of preview.rows) {
      if (!previewRow.row) {
        await tx.insert(importRows).values({
          importId: importRecord.id,
          sourceRow: previewRow.sourceRow,
          action: "invalid",
          raw: {},
          errors: previewRow.errors,
        });
        continue;
      }
      const row = previewRow.row;
      const normalisedDomain = extractDomain(row.websiteUrl);
      const normalisedName = normaliseName(row.company);
      const match = normalisedDomain
        ? await tx
            .select()
            .from(companies)
            .where(
              and(
                eq(companies.organisationId, organisationId),
                eq(companies.normalisedDomain, normalisedDomain),
              ),
            )
            .limit(1)
        : await tx
            .select()
            .from(companies)
            .where(
              and(
                eq(companies.organisationId, organisationId),
                eq(companies.normalisedName, normalisedName),
              ),
            )
            .limit(1);

      let company = match[0];
      const companyValues = {
        organisationId,
        name: row.company,
        normalisedName,
        domain: normalisedDomain,
        normalisedDomain,
        websiteUrl: valueOrNull(row.websiteUrl),
        linkedinUrl: valueOrNull(row.linkedinCompanyUrl),
        storeCount: extractStoreCount(row.scaleNote),
        scaleNote: valueOrNull(row.scaleNote),
        sector: valueOrNull(row.category),
        fitScore: row.fitScore,
        researchNote: valueOrNull([row.priorityReason, row.notes].filter(Boolean).join("\n\n")),
        sourceUrls: splitUrls(row.sourceUrls),
        legitimateInterestReason: valueOrNull(row.priorityReason),
        importMetadata: { trackerChecksum: preview.checksum, sourceRows: [row.sourceRow] },
        updatedAt: new Date(),
      };
      if (company) {
        [company] = await tx
          .update(companies)
          .set(companyValues)
          .where(eq(companies.id, company.id))
          .returning();
        companiesUpdated += 1;
      } else {
        [company] = await tx.insert(companies).values(companyValues).returning();
        companiesCreated += 1;
      }

      const stageName = mapTrackerStage(row.outreachStatus, row.researchStatus);
      const stage = importOfferId ? stageByName.get(stageName) ?? fallbackStage : fallbackStage;
      const [existingOpportunity] = await tx
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.organisationId, organisationId),
            eq(opportunities.pipelineId, pipeline.id),
            eq(opportunities.companyId, company.id),
            importOfferId ? eq(opportunities.offerId, importOfferId) : offerRows.length > 1 ? isNull(opportunities.offerId) : undefined,
          ),
        )
        .limit(1);

      let opportunity = existingOpportunity;
      if (!opportunity) {
        [opportunity] = await tx
          .insert(opportunities)
          .values({
            organisationId,
            pipelineId: pipeline.id,
            offerId: importOfferId,
            companyId: company.id,
            stageId: stage.id,
            ownerId: createdById,
            title: `${row.company} outreach`,
            priority: mapPriority(row.initialPriority, row.fitScore),
            temperature: "cold",
            outreachAngle: valueOrNull(row.outreachAngle),
            importMetadata: { trackerChecksum: preview.checksum, sourceRow: row.sourceRow },
          })
          .returning();
        opportunitiesCreated += 1;
      }

      for (const candidate of [
        { name: row.contact1Name, title: row.contact1Title, linkedinUrl: row.contact1LinkedinUrl, primary: true },
        { name: row.contact2Name, title: row.contact2Title, linkedinUrl: row.contact2LinkedinUrl, primary: false },
      ]) {
        if (!candidate.name) continue;
        const normalisedContactName = normaliseName(candidate.name);
        const [existingContact] = await tx
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.companyId, company.id),
              eq(contacts.normalisedName, normalisedContactName),
            ),
          )
          .limit(1);
        const contact =
          existingContact ??
          (
            await tx
              .insert(contacts)
              .values({
                organisationId,
                companyId: company.id,
                name: candidate.name,
                normalisedName: normalisedContactName,
                title: valueOrNull(candidate.title),
                linkedinUrl: valueOrNull(candidate.linkedinUrl),
                sourceUrls: splitUrls(row.sourceUrls),
                importMetadata: { trackerChecksum: preview.checksum, sourceRow: row.sourceRow },
              })
              .returning()
          )[0];
        if (!existingContact) contactsCreated += 1;
        await tx
          .insert(opportunityContacts)
          .values({ opportunityId: opportunity.id, contactId: contact.id, primary: candidate.primary })
          .onConflictDoNothing();
      }

      if (row.nextAction && isActionable(row.nextAction) && !["Lost", "Nurture", "Research holding"].includes(stage.name)) {
        const [existingTask] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.opportunityId, opportunity.id),
              eq(tasks.title, row.nextAction.slice(0, 240)),
              eq(tasks.status, "open"),
            ),
          )
          .limit(1);
        if (!existingTask) {
          const dueAt = new Date();
          dueAt.setDate(dueAt.getDate() + 3);
          await tx.insert(tasks).values({
            organisationId,
            opportunityId: opportunity.id,
            ownerId: createdById,
            title: row.nextAction.slice(0, 240),
            dueAt,
            source: "tracker_import",
          });
          await tx.update(opportunities).set({ nextActionAt: dueAt }).where(eq(opportunities.id, opportunity.id));
          tasksCreated += 1;
        }
      }

      await tx.insert(importRows).values({
        importId: importRecord.id,
        sourceRow: row.sourceRow,
        action: previewRow.action,
        entityId: opportunity.id,
        raw: row.raw,
        errors: [],
      });
    }

    const finalReport = {
      rowsProcessed: preview.rows.length,
      invalidRows: preview.invalidRows,
      companiesCreated,
      companiesUpdated,
      contactsCreated,
      opportunitiesCreated,
      tasksCreated,
    };
    await tx
      .update(imports)
      .set({ status: "committed", committedAt: new Date(), report: finalReport })
      .where(eq(imports.id, importRecord.id));
    return { importId: importRecord.id, alreadyCommitted: false, report: finalReport };
  });

  return report;
}

export function companyKey(websiteUrl: string, name: string) {
  return extractDomain(websiteUrl) ?? normaliseName(name);
}

export function mapTrackerStage(outreachStatus: string, researchStatus: string) {
  const outreach = outreachStatus.toLowerCase();
  const research = researchStatus.toLowerCase();
  if (outreach.includes("closed") || outreach.includes("paused") || outreach.includes("watch")) return "Research holding";
  if (outreach.includes("outreach") && !outreach.includes("ready")) return "Outreach active";
  if (outreach.includes("ready") || outreach.includes("soft queue") || research.includes("contact")) return "Ready to contact";
  return "Researching";
}

function mapPriority(value: string, fitScore: number | null): "low" | "medium" | "high" | "critical" {
  const priorityValue = value.toLowerCase();
  if (priorityValue.startsWith("a") || fitScore === 5) return "high";
  if (priorityValue.startsWith("b") || (fitScore && fitScore >= 3)) return "medium";
  return "low";
}

function integerOrNull(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

type XmlNode = Record<string, unknown>;

function readOoxmlSheet(bytes: Uint8Array, sheetName: string): string[][] {
  const archive = unzipSync(bytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    trimValues: false,
    removeNSPrefix: true,
  });
  const parseFile = (name: string) => {
    const file = archive[name];
    if (!file) throw new Error(`Workbook part is missing: ${name}`);
    return asNode(parser.parse(strFromU8(file)));
  };

  const workbook = asNode(parseFile("xl/workbook.xml").workbook);
  const sheetNodes = asArray(asNode(workbook.sheets).sheet).map(asNode);
  const targetSheet = sheetNodes.find((sheet) => textValue(sheet["@name"]) === sheetName);
  if (!targetSheet) throw new Error(`The workbook does not contain a "${sheetName}" sheet.`);

  const relationships = asArray(
    asNode(parseFile("xl/_rels/workbook.xml.rels").Relationships).Relationship,
  ).map(asNode);
  const relationId = textValue(targetSheet["@r:id"] ?? targetSheet["@id"]);
  const relationship = relationships.find((item) => textValue(item["@Id"]) === relationId);
  if (!relationship) throw new Error(`The "${sheetName}" worksheet relationship is missing.`);
  const target = textValue(relationship["@Target"]);
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;

  const sharedStringsFile = archive["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsFile
    ? asArray(asNode(asNode(parser.parse(strFromU8(sharedStringsFile))).sst).si).map(richText)
    : [];
  const worksheet = asNode(parseFile(sheetPath).worksheet);
  const rowNodes = asArray(asNode(worksheet.sheetData).row).map(asNode);
  const rows: string[][] = [];

  for (const rowNode of rowNodes) {
    const rowNumber = Number.parseInt(textValue(rowNode["@r"]), 10) || rows.length + 1;
    const row: string[] = [];
    for (const cellValue of asArray(rowNode.c)) {
      const cell = asNode(cellValue);
      const reference = textValue(cell["@r"]);
      const column = columnIndex(reference);
      const type = textValue(cell["@t"]);
      const raw = textValue(cell.v);
      let value = raw;
      if (type === "s") value = sharedStrings[Number.parseInt(raw, 10)] ?? "";
      if (type === "inlineStr") value = richText(cell.is);
      if (type === "b") value = raw === "1" ? "true" : "false";
      row[column] = value;
    }
    rows[rowNumber - 1] = row;
  }
  return rows.map((row) => row ?? []);
}

function asNode(value: unknown): XmlNode {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function textValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  const node = asNode(value);
  return textValue(node["#text"] ?? node.t ?? node.v);
}

function richText(value: unknown): string {
  const node = asNode(value);
  const direct = textValue(node.t);
  if (direct) return direct;
  return asArray(node.r)
    .map((run) => textValue(asNode(run).t))
    .join("");
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function extractStoreCount(value: string) {
  const direct = value.match(/(?:about|around|roughly|approximately|~)?\s*(\d{1,4})\s+(?:uk\s+)?stores?/i);
  return direct ? Number.parseInt(direct[1], 10) : null;
}

function splitUrls(value: string) {
  return value.split(/\s*;\s*/).map((item) => item.trim()).filter(isSafeHttpUrl);
}

function valueOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function mergeText(existing: string | null | undefined, ...values: string[]) {
  const paragraphs = [existing ?? "", ...values].map((value) => value.trim()).filter(Boolean);
  return paragraphs.length ? [...new Set(paragraphs)].join("\n\n") : null;
}

function isActionable(value: string) {
  const normalised = value.toLowerCase();
  return !["use as reference", "paused", "keep as", "closed", "do not contact"].some((phrase) => normalised.startsWith(phrase));
}
