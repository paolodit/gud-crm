import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { isSafeHttpUrl } from "@/lib/domain/normalise";
import type { McpActor } from "@/lib/mcp/service";
import {
  createOpportunity,
  describeWorkspace,
  enrichContactEmail,
  getOpportunity,
  listOpportunities,
  logActivity,
  searchCompanies,
  setNextAction,
  submitResearchResults,
  updateOpportunity,
} from "@/lib/mcp/service";

const safeUrl = z.url().refine(isSafeHttpUrl, "Only complete HTTP or HTTPS URLs are accepted.");
const optionalSafeUrl = z.union([z.literal(""), safeUrl]).optional();
const dateTime = z.iso.datetime({ offset: true });
const priority = z.enum(["low", "medium", "high", "critical"]);
const temperature = z.enum(["cold", "warm", "hot", "at_risk", "unresponsive"]);
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

export const GUD_MCP_TOOL_NAMES = [
  "describe_workspace",
  "list_opportunities",
  "get_opportunity",
  "search_companies",
  "submit_research_results",
  "create_opportunity",
  "update_opportunity",
  "set_next_action",
  "log_activity",
  "find_work_email",
] as const;

export function createGudMcpServer(context: {
  actor: McpActor;
  scopes: string[];
  clientId: string;
}) {
  const server = new McpServer(
    { name: "gud-crm", version: "0.1.0" },
    {
      instructions:
        "GUD is the sales system of record. Read before writing. Put unverified findings into submit_research_results with public source URLs. Never guess contact data, initiate outreach, delete records, or move an opportunity to Won/Lost without the user's explicit confirmation.",
    },
  );

  server.registerTool(
    "describe_workspace",
    {
      title: "Describe GUD workspace",
      description: "Use first to learn this workspace's edition, offers, stages, activity taxonomy and guardrails.",
      inputSchema: {},
      annotations: readAnnotations,
    },
    async () => toolResult(() => describeWorkspace(context.actor)),
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
        limit: z.number().int().min(1).max(100).default(50),
      },
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
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: readAnnotations,
    },
    async ({ query, limit }) => toolResult(() => searchCompanies(context.actor, query, limit)),
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
      annotations: writeAnnotations,
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
      annotations: writeAnnotations,
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
      annotations: writeAnnotations,
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
      annotations: writeAnnotations,
    },
    async (input) => toolResult(async () => {
      requireWriteScope(context.scopes);
      return setNextAction(context.actor, { ...input, dueAt: new Date(input.dueAt) });
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
      annotations: writeAnnotations,
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
    "find_work_email",
    {
      title: "Find work email with FreeMax",
      description: "Use GUD's configured Hunter/Voila Norbert allowances to find a work email for a named contact. GUD uses the safest available provider order and records usage.",
      inputSchema: {
        opportunityId: z.uuid(),
        contactId: z.uuid(),
      },
      annotations: externalWriteAnnotations,
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

const externalWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

function requireWriteScope(scopes: string[]) {
  if (!scopes.includes("gud:write")) throw new Error("This connection has read-only access. Reconnect GUD with write permission.");
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      structuredContent: { result },
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
