import { z } from "zod";

import { isSafeHttpUrl } from "@/lib/domain/normalise";
import { firstTargetMissingExplicitContacts } from "@/lib/import/research-contacts";

const httpUrl = z.url().refine(isSafeHttpUrl, "Only HTTP and HTTPS source links are allowed.");
const optionalUrl = z.string().trim().max(2_000).refine(
  (value) => !value || isSafeHttpUrl(value),
  "Source and profile links must be complete URLs.",
).optional().default("");

const researchContactSchema = z.object({
  name: z.string().trim().min(2).max(220),
  title: z.string().trim().max(255).optional().default(""),
  email: z.union([z.literal(""), z.email()]).optional().default(""),
  phone: z.string().trim().max(80).optional().default(""),
  linkedinUrl: optionalUrl,
  preferredChannel: z.enum(["linkedin", "email", "phone", "meeting", "physical", "note"]).nullable().optional(),
  sourceUrls: z.array(httpUrl).max(30).optional().default([]),
});

const researchEvidenceSchema = z.object({
  claim: z.string().trim().min(2).max(2_000),
  url: httpUrl,
  observedAt: z.string().trim().max(80).optional().default(""),
});

export const researchTargetSchema = z.object({
  opportunityId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  offerId: z.uuid().nullable().optional(),
  offerName: z.string().trim().max(160).optional().default(""),
  name: z.string().trim().min(2).max(220),
  websiteUrl: optionalUrl,
  linkedinUrl: optionalUrl,
  sector: z.string().trim().max(160).optional().default(""),
  fitScore: z.number().int().min(1).max(5).nullable().optional(),
  scaleNote: z.string().trim().max(2_000).optional().default(""),
  researchNote: z.string().trim().max(10_000).optional().default(""),
  sourceUrls: z.array(httpUrl).max(100).optional().default([]),
  evidence: z.array(researchEvidenceSchema).max(100).optional().default([]),
  contacts: z.array(researchContactSchema).max(20).optional(),
});

export const researchImportSchema = z.object({
  schemaVersion: z.number().int().optional(),
  contactMode: z.enum(["merge", "replace"]).optional().default("merge"),
  targets: z.array(researchTargetSchema).min(1).max(500),
}).superRefine((value, context) => {
  if (value.contactMode !== "replace") return;
  const index = firstTargetMissingExplicitContacts(value.targets);
  if (index >= 0) context.addIssue({
    code: "custom",
    path: ["targets", index, "contacts"],
    message: `Replace contacts requires target ${index + 1} to include an explicit \"contacts\" array. Use [] to clear its contacts.`,
  });
});

export type ResearchTargetInput = z.infer<typeof researchTargetSchema>;

export function parseResearchImport(input: unknown) {
  return researchImportSchema.safeParse(Array.isArray(input) ? { targets: input } : input);
}
