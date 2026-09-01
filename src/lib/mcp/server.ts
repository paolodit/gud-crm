import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { isSafeHttpUrl } from "@/lib/domain/normalise";
import type { McpActor } from "@/lib/mcp/service";
import {
  archiveCompany,
  archiveOpportunity,
  completeTask,
  createOpportunity,
  describeWorkspace,
  enrichContactEmail,
  getOpportunity,
  getSalesBrief,
  listOpportunities,
  logActivity,
  restoreCompany,
  restoreOpportunity,
  saveContact,
  searchCompanies,
  setNextAction,
  submitResearchResults,
  updateCompany,
  updateOpportunity,
} from "@/lib/mcp/service";

const safeUrl = z.url().refine(isSafeHttpUrl, "Only complete HTTP or HTTPS URLs are accepted.");
const optionalSafeUrl = z.union([z.literal(""), safeUrl]).optional();
const dateTime = z.iso.datetime({ offset: true });
const priority = z.enum(["low", "medium", "high", "critical"]);
const temperature = z.enum(["cold", "warm", "hot", "at_risk", "unresponsive"]);
const preferredChannel = z.enum(["linkedin", "email", "phone", "meeting", "physical", "note"]);
const nextAction = z.object({
  title: z.string().trim().min(2).max(240),
  dueAt: dateTime,
});
const contact = z.object({
  name: z.string().trim().min(2).max(220),
  title: z.string().trim().max(255).optional(),
  email: z.union([z.literal(""), z.email()]).optional(),
  phone: z.string().trim().max(80).optional(),
  linkedinUrl: optionalSafeUrl,
  sourceUrls: z.array(safeUrl).max(30).optional(),
});
const salesBriefRecord = z.object({
  opportunityId: z.uuid(),
  title: z.string(),
  company: z.object({ id: z.uuid(), name: z.string() }),
  stage: z.object({ id: z.uuid(), name: z.string() }),
  offer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  priority,
  temperature,
  expectedValue: z.number().nullable(),
  probability: z.number().int().nullable(),
});
const salesBriefOutput = z.object({
  generatedAt: z.string(),
  scope: z.enum(["owner", "team"]),
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  horizonDays: z.number().int(),
  totals: z.object({
    activeOpportunities: z.number().int(),
    pipelineValue: z.number(),
    weightedPipelineValue: z.number(),
    needsAttention: z.number().int(),
    upcomingActions: z.number().int(),
  }),
  stageBreakdown: z.array(z.object({
    stageId: z.uuid(),
    stageName: z.string(),
    count: z.number().int(),
    value: z.number(),
    weightedValue: z.number(),
  })),
  needsAttention: z.array(salesBriefRecord.extend({
    reasons: z.array(z.string()),
    nextAction: z.object({ id: z.uuid(), title: z.string(), dueAt: z.string() }).nullable(),
  })),
  upcomingActions: z.array(salesBriefRecord.extend({
    taskId: z.uuid(),
    action: z.string(),
    dueAt: z.string(),
  })),
  suggestedStart: z.string(),
});
const genericToolOutputSchema = { result: z.unknown() } as const;

export const GUD_MCP_TOOL_NAMES = [
  "describe_workspace",
  "get_sales_brief",
  "list_opportunities",
  "get_opportunity",
  "search_companies",
  "submit_research_results",
  "create_opportunity",
  "update_company",
  "save_contact",
  "update_opportunity",
  "set_next_action",
  "complete_task",
  "log_activity",
  "archive_opportunity",
  "restore_opportunity",
  "archive_company",
  "restore_company",
  "find_work_email",
] as const;

export function createGudMcpServer(context: {
  actor: McpActor;
  scopes: string[];
  clientId: string;
}) {
  const server = new McpServer(
    { name: "gud-crm", version: "0.3.0" },
    {
      instructions:
        "GUD is the sales system of record. Start with get_sales_brief for an at-a-glance view, then read the exact opportunity before writing. After a write, report exactly what changed, the returned record ID and the sensible next step. Put unverified findings into submit_research_results with public source URLs. Never guess contact data, initiate outreach, remove do-not-contact protection, archive records, or move an opportunity to Won/Lost without the user's explicit confirmation.",
    },
  );

  server.registerTool(
    "describe_workspace",
    {
      title: "Describe GUD workspace",
      description: "Use first to learn this workspace's edition, offers, stages, activity taxonomy and guardrails.",
      inputSchema: {},
      outputSchema: genericToolOutputSchema,
      annotations: readAnnotations,
    },
    async () => toolResult(() => describeWorkspace(context.actor)),
  );

  server.registerTool(
    "get_sales_brief",
    {
      title: "Get my sales brief",
      description: "Use at the start of a session or when the user asks what needs attention. Returns a personal, selected-owner or team view of active pipeline value, stage balance, overdue or missing next actions, and work due soon. It never changes CRM data.",
      inputSchema: {
        scope: z.enum(["mine", "team"]).default("mine").describe("Use mine for the signed-in person's work or team for the whole active pipeline."),
        ownerId: z.string().trim().max(220).optional().describe("Workspace member ID. Defaults to the signed-in person."),
        horizonDays: z.number().int().min(1).max(30).default(7).describe("How far ahead to include upcoming actions."),
        limit: z.number().int().min(1).max(25).default(10).describe("Maximum attention and upcoming-action records per section."),
      },
      outputSchema: { result: salesBriefOutput },
      annotations: readAnnotations,
      _meta: toolStatus("Preparing your sales brief…", "Sales brief ready"),
    },
    async (input) => toolResult(() => getSalesBrief(context.actor, input)),
  );

  server.registerTool(
    "list_opportunities",
    {
      title: "List opportunities",
      description: "Find and review opportunities. Filters are optional; use needsAttention for overdue or missing next actions.",
      inputSchema: {
        query: z.string().trim().max(220).optional(),
        stageId: z.uuid().optional(),
        stageName: z.string().trim().max(120).optional(),
        ownerId: z.string().trim().max(220).optional(),
        offerId: z.uuid().optional(),
        needsAttention: z.boolean().optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: genericToolOutputSchema,
      annotations: readAnnotations,
    },
    async (input) => toolResult(() => listOpportunities(context.actor, input)),
  );

  server.registerTool(
    "get_opportunity",
    {
      title: "Get opportunity",
      description: "Read one opportunity with its company, contacts, open tasks and recent activity before suggesting or making a change.",
      inputSchema: { opportunityId: z.uuid() },
      outputSchema: genericToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ opportunityId }) => toolResult(() => getOpportunity(context.actor, opportunityId)),
  );

  server.registerTool(
    "search_companies",
    {
      title: "Search companies",
      description: "Search existing organisations before creating research or an opportunity, reducing duplicate records.",
      inputSchema: {
        query: z.string().trim().max(220).default(""),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      },
      outputSchema: genericToolOutputSchema,
      annotations: readAnnotations,
    },
    async ({ query, limit, includeArchived }) => toolResult(() => searchCompanies(context.actor, query, limit, includeArchived)),
  );

  server.registerTool(
    "submit_research_results",
    {
      title: "Submit research for review",
      description: "Add evidence-backed company and contact research to GUD. New targets stay in Researching for human review; this never initiates outreach.",
      inputSchema: {
        companyName: z.string().trim().min(2).max(220),
        websiteUrl: optionalSafeUrl,
        companyLinkedinUrl: optionalSafeUrl,
        sector: z.string().trim().max(160).optional(),
        fitScore: z.number().int().min(1).max(5).nullable().optional(),
        offerId: z.uuid().nullable().optional(),
        offerName: z.string().trim().max(160).optional(),
        researchSummary: z.string().trim().max(10_000).optional(),
        evidence: z.array(z.object({
          claim: z.string().trim().min(2).max(2_000),
          url: safeUrl,
          observedAt: z.string().trim().max(80).optional(),
        })).max(100).optional(),
        sourceUrls: z.array(safeUrl).max(100).optional(),
        contacts: z.array(contact).max(20).optional(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: writeAnnotations,
      _meta: toolStatus("Saving research for review…", "Research saved for review"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return submitResearchResults(context.actor, {
        ...input,
        websiteUrl: input.websiteUrl || undefined,
        companyLinkedinUrl: input.companyLinkedinUrl || undefined,
        contacts: input.contacts?.map((item) => ({
          ...item,
          linkedinUrl: item.linkedinUrl || undefined,
        })),
      });
    }),
  );

  server.registerTool(
    "create_opportunity",
    {
      title: "Create opportunity",
      description: "Create a sales opportunity after confirming the organisation, offer and relevant context. Use submit_research_results when fit or contact evidence still needs review.",
      inputSchema: {
        companyName: z.string().trim().min(2).max(220),
        title: z.string().trim().min(2).max(220),
        websiteUrl: optionalSafeUrl,
        companyLinkedinUrl: optionalSafeUrl,
        sector: z.string().trim().max(160).optional(),
        fitScore: z.number().int().min(1).max(5).nullable().optional(),
        offerId: z.uuid().nullable().optional(),
        offerName: z.string().trim().max(160).optional(),
        stageId: z.uuid().optional(),
        stageName: z.string().trim().max(120).optional(),
        ownerId: z.string().trim().max(220).nullable().optional(),
        priority: priority.default("medium"),
        temperature: temperature.default("cold"),
        expectedValue: z.number().min(0).max(999_999_999).nullable().optional(),
        probability: z.number().int().min(0).max(100).nullable().optional(),
        expectedCloseDate: dateTime.nullable().optional(),
        outreachAngle: z.string().trim().max(10_000).optional(),
        contact: contact.optional(),
        nextAction: nextAction.optional(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: writeAnnotations,
      _meta: toolStatus("Creating the opportunity…", "Opportunity created"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return createOpportunity(context.actor, {
        ...input,
        websiteUrl: input.websiteUrl || undefined,
        companyLinkedinUrl: input.companyLinkedinUrl || undefined,
        expectedCloseDate: input.expectedCloseDate === undefined
          ? undefined
          : input.expectedCloseDate === null
            ? null
            : new Date(input.expectedCloseDate),
        contact: input.contact ? {
          ...input.contact,
          linkedinUrl: input.contact.linkedinUrl || undefined,
        } : undefined,
        nextAction: input.nextAction ? {
          ...input.nextAction,
          dueAt: new Date(input.nextAction.dueAt),
        } : undefined,
      });
    }),
  );

  server.registerTool(
    "update_company",
    {
      title: "Update organisation",
      description: "Update a known organisation after finding it with search_companies or get_opportunity. Research notes and source URLs are appended; clearing do-not-contact protection requires explicit confirmation.",
      inputSchema: {
        companyId: z.uuid(),
        name: z.string().trim().min(2).max(220).optional(),
        websiteUrl: z.union([safeUrl, z.null()]).optional(),
        linkedinUrl: z.union([safeUrl, z.null()]).optional(),
        sector: z.string().trim().max(160).nullable().optional(),
        fitScore: z.number().int().min(1).max(5).nullable().optional(),
        scaleNote: z.string().trim().max(2_000).nullable().optional(),
        researchNoteAppend: z.string().trim().min(2).max(10_000).optional(),
        sourceUrls: z.array(safeUrl).max(100).optional(),
        doNotContact: z.boolean().optional(),
        confirmRemoveDoNotContact: z.boolean().default(false),
      },
      outputSchema: genericToolOutputSchema,
      annotations: destructiveWriteAnnotations,
      _meta: toolStatus("Updating the organisation…", "Organisation updated"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return updateCompany(context.actor, input);
    }),
  );

  server.registerTool(
    "save_contact",
    {
      title: "Add or update contact",
      description: "Add a person to an opportunity or update a contact already linked to it. Read the opportunity first and supply contactId when updating; existing provenance and do-not-contact metadata are preserved unless explicitly changed.",
      inputSchema: {
        opportunityId: z.uuid(),
        contactId: z.uuid().optional(),
        name: z.string().trim().min(2).max(220),
        title: z.string().trim().max(255).nullable().optional(),
        email: z.union([z.email(), z.null()]).optional(),
        phone: z.string().trim().max(80).nullable().optional(),
        linkedinUrl: z.union([safeUrl, z.null()]).optional(),
        preferredChannel: preferredChannel.nullable().optional(),
        doNotContact: z.boolean().optional(),
        confirmRemoveDoNotContact: z.boolean().default(false),
        primary: z.boolean().optional(),
        sourceUrls: z.array(safeUrl).max(30).optional(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: destructiveWriteAnnotations,
      _meta: toolStatus("Saving the contact…", "Contact saved"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return saveContact(context.actor, input);
    }),
  );

  server.registerTool(
    "update_opportunity",
    {
      title: "Update opportunity",
      description: "Apply a focused patch to an existing opportunity. Read it first. Moving to Won or Lost requires confirmTerminalMove=true after explicit user confirmation.",
      inputSchema: {
        opportunityId: z.uuid(),
        title: z.string().trim().min(2).max(220).optional(),
        offerId: z.uuid().nullable().optional(),
        offerName: z.string().trim().max(160).optional(),
        stageId: z.uuid().optional(),
        stageName: z.string().trim().max(120).optional(),
        ownerId: z.string().trim().max(220).nullable().optional(),
        priority: priority.optional(),
        temperature: temperature.optional(),
        expectedValue: z.number().min(0).max(999_999_999).nullable().optional(),
        probability: z.number().int().min(0).max(100).nullable().optional(),
        expectedCloseDate: dateTime.nullable().optional(),
        outreachAngle: z.string().trim().max(10_000).optional(),
        confirmTerminalMove: z.boolean().default(false),
      },
      outputSchema: genericToolOutputSchema,
      annotations: destructiveWriteAnnotations,
      _meta: toolStatus("Updating the opportunity…", "Opportunity updated"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return updateOpportunity(context.actor, {
        ...input,
        expectedCloseDate: input.expectedCloseDate === undefined
          ? undefined
          : input.expectedCloseDate === null
            ? null
            : new Date(input.expectedCloseDate),
      });
    }),
  );

  server.registerTool(
    "set_next_action",
    {
      title: "Set next action",
      description: "Create a dated next action for an existing opportunity. Keep it specific, proportionate and owned.",
      inputSchema: {
        opportunityId: z.uuid(),
        title: z.string().trim().min(2).max(240),
        dueAt: dateTime,
        contactId: z.uuid().nullable().optional(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: writeAnnotations,
      _meta: toolStatus("Setting the next action…", "Next action set"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return setNextAction(context.actor, { ...input, dueAt: new Date(input.dueAt) });
    }),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete next action",
      description: "Mark one open task from get_opportunity as completed. This never invents a replacement action; if none remains, the opportunity returns to needs-attention state.",
      inputSchema: {
        opportunityId: z.uuid(),
        taskId: z.uuid(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: idempotentWriteAnnotations,
      _meta: toolStatus("Completing the action…", "Action completed"),
    },
    async ({ opportunityId, taskId }) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return completeTask(context.actor, opportunityId, taskId);
    }),
  );

  server.registerTool(
    "log_activity",
    {
      title: "Log sales activity",
      description: "Record a completed sales touch and its outcome. Use an activity type from describe_workspace and do not claim an activity happened without user confirmation.",
      inputSchema: {
        opportunityId: z.uuid(),
        activityTypeId: z.uuid().optional(),
        activityTypeName: z.string().trim().max(140).optional(),
        contactId: z.uuid().nullable().optional(),
        outcome: z.string().trim().max(220).nullable().optional(),
        notes: z.string().trim().max(10_000).nullable().optional(),
        occurredAt: dateTime,
        nextAction: nextAction.optional(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: writeAnnotations,
      _meta: toolStatus("Logging the sales activity…", "Sales activity logged"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      if (!input.activityTypeId && !input.activityTypeName) {
        throw new Error("Provide activityTypeId or activityTypeName from describe_workspace.");
      }
      const occurredAt = new Date(input.occurredAt);
      if (occurredAt.getTime() > Date.now() + 60_000) throw new Error("Activity time cannot be in the future.");
      return logActivity(context.actor, {
        ...input,
        occurredAt,
        nextAction: input.nextAction ? {
          ...input.nextAction,
          dueAt: new Date(input.nextAction.dueAt),
        } : undefined,
      });
    }),
  );

  server.registerTool(
    "archive_opportunity",
    {
      title: "Archive opportunity",
      description: "Hide one opportunity from active views without deleting its contacts, tasks, activities or audit history. Call only after the user explicitly asks to archive that exact record.",
      inputSchema: {
        opportunityId: z.uuid(),
        confirmArchive: z.literal(true),
      },
      outputSchema: genericToolOutputSchema,
      annotations: destructiveIdempotentWriteAnnotations,
      _meta: toolStatus("Archiving the opportunity…", "Opportunity archived"),
    },
    async ({ opportunityId, confirmArchive }) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return archiveOpportunity(context.actor, opportunityId, confirmArchive);
    }),
  );

  server.registerTool(
    "restore_opportunity",
    {
      title: "Restore opportunity",
      description: "Return an archived opportunity to active views, preserving its existing stage and history.",
      inputSchema: { opportunityId: z.uuid() },
      outputSchema: genericToolOutputSchema,
      annotations: idempotentWriteAnnotations,
      _meta: toolStatus("Restoring the opportunity…", "Opportunity restored"),
    },
    async ({ opportunityId }) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return restoreOpportunity(context.actor, opportunityId);
    }),
  );

  server.registerTool(
    "archive_company",
    {
      title: "Archive organisation",
      description: "Hide an organisation and all of its opportunities from active views without deleting history. Call only after the user explicitly confirms the organisation-wide impact.",
      inputSchema: {
        companyId: z.uuid(),
        confirmArchive: z.literal(true),
      },
      outputSchema: genericToolOutputSchema,
      annotations: destructiveIdempotentWriteAnnotations,
      _meta: toolStatus("Archiving the organisation…", "Organisation archived"),
    },
    async ({ companyId, confirmArchive }) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return archiveCompany(context.actor, companyId, confirmArchive);
    }),
  );

  server.registerTool(
    "restore_company",
    {
      title: "Restore organisation",
      description: "Return an archived organisation and its opportunities to active views, preserving their stages and history.",
      inputSchema: { companyId: z.uuid() },
      outputSchema: genericToolOutputSchema,
      annotations: idempotentWriteAnnotations,
      _meta: toolStatus("Restoring the organisation…", "Organisation restored"),
    },
    async ({ companyId }) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return restoreCompany(context.actor, companyId);
    }),
  );

  server.registerTool(
    "find_work_email",
    {
      title: "Find work email with FreeMax",
      description: "Use GUD's configured Hunter/Voila Norbert allowances to find a work email for a named contact. GUD uses the safest available provider order and records usage.",
      inputSchema: {
        opportunityId: z.uuid(),
        contactId: z.uuid(),
      },
      outputSchema: genericToolOutputSchema,
      annotations: externalWriteAnnotations,
      _meta: toolStatus("Checking FreeMax providers…", "Work email lookup complete"),
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return enrichContactEmail(context.actor, input);
    }),
  );

  server.registerResource(
    "gud-workspace-context",
    "gud://workspace/context",
    {
      title: "GUD workspace context",
      description: "Current pipeline stages, offers, activity types and safe operating guardrails.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await describeWorkspace(context.actor), null, 2),
      }],
    }),
  );

  server.registerResource(
    "gud-coworker-workflows",
    "gud://workspace/workflows",
    {
      title: "GUD coworker workflows",
      description: "Practical read-first patterns for reviewing sales work, capturing an update and returning researched targets safely.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          review: ["get_sales_brief", "get_opportunity", "set_next_action"],
          captureUpdate: ["list_opportunities", "get_opportunity", "describe_workspace", "log_activity", "set_next_action"],
          research: ["search_companies", "describe_workspace", "submit_research_results"],
          enrich: ["get_opportunity", "find_work_email"],
          rules: [
            "Read the exact record before writing.",
            "Do not invent activity, contact details, outcomes or private data.",
            "Use public source URLs for research and keep it in human review.",
            "Ask for explicit confirmation before terminal moves or archives.",
          ],
        }, null, 2),
      }],
    }),
  );

  server.registerPrompt(
    "research_for_gud",
    {
      title: "Research an account for GUD",
      description: "Prepare proportionate, evidence-backed account research that can be submitted to GUD for review.",
      argsSchema: {
        company: z.string().trim().min(2).max(220),
        offer: z.string().trim().max(160).optional(),
      },
    },
    async ({ company, offer }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Research ${company}${offer ? ` for the ${offer} offer` : ""}.`,
            "Confirm the organisation and domain, find useful current evidence, and identify no more than two credible buyer candidates.",
            "Do not guess names, roles, email addresses, phone numbers or URLs.",
            "Include a public source URL and observation date for every material claim.",
            "Search GUD first to avoid duplicates, then use submit_research_results so a human can review the findings.",
          ].join(" "),
        },
      }],
    }),
  );

  server.registerPrompt(
    "review_my_sales",
    {
      title: "Review my sales work",
      description: "Give the signed-in user a concise start-of-session brief and help them choose one useful next move.",
      argsSchema: {
        horizonDays: z.string().trim().max(2).optional(),
      },
    },
    async ({ horizonDays }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Use get_sales_brief for the signed-in user with a ${horizonDays || "7"}-day horizon. Present no more than three attention items, the weighted pipeline, and the single best place to start. Do not change anything until I choose a record.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "capture_sales_update",
    {
      title: "Capture a sales update",
      description: "Turn a natural-language update into checked CRM activity and a sensible next action without guessing.",
      argsSchema: {
        update: z.string().trim().min(2).max(4_000),
      },
    },
    async ({ update }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `Capture this sales update in GUD: ${update}`,
            "Find the matching opportunity and read it first. If the record is ambiguous, stop and ask me to choose.",
            "Use describe_workspace for the current activity taxonomy. Only log an activity that I clearly said happened.",
            "Show the proposed activity, outcome, date and next action before writing; do not infer missing facts.",
            "After saving, report the record ID and exactly what changed.",
          ].join(" "),
        },
      }],
    }),
  );

  return server;
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const destructiveWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

const idempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const destructiveIdempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const externalWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

function requireWriteScope(scopes: string[]) {
  if (!scopes.includes("gud:write")) throw new Error("This connection has read-only access. Reconnect GUD with write permission.");
}

function toolStatus(invoking: string, invoked: string) {
  return {
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      structuredContent: { result },
      content: [{ type: "text" as const, text: `${summariseResult(result)}\n\n${JSON.stringify(result, null, 2)}` }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : "GUD could not complete that request.",
      }],
    };
  }
}

function summariseResult(result: unknown) {
  if (Array.isArray(result)) return `GUD returned ${result.length} ${result.length === 1 ? "record" : "records"}.`;
  if (!result || typeof result !== "object") return "GUD completed the request.";
  const value = result as Record<string, unknown>;
  const totals = value.totals as Record<string, unknown> | undefined;
  if (totals && typeof totals.activeOpportunities === "number") {
    return `Sales brief ready: ${totals.activeOpportunities} active opportunities, ${totals.needsAttention ?? 0} needing attention and ${totals.upcomingActions ?? 0} actions due in the selected horizon.`;
  }
  const identity = [value.opportunityId, value.companyId, value.contactId, value.taskId, value.activityId, value.id]
    .find((item) => typeof item === "string");
  return identity ? `GUD completed the request. Saved record: ${identity}.` : "GUD completed the request successfully.";
}
