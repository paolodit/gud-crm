import { z } from "zod";

import { isResearchStage } from "@/lib/data/board-selectors";
import { normaliseDialNumber, phoneKey } from "@/lib/domain/phone";
import type { OpportunitySummary, StageSummary } from "@/lib/domain/types";

export const outreachOutcomes = {
  no_answer: "No answer",
  gatekeeper: "Gatekeeper reached",
  decision_maker: "Decision-maker reached",
  demo_booked: "Demo booked",
  follow_up: "Follow-up required",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

export const outreachScripts = {
  opener: "Hi, it’s [your name] from HSM App. Could you point me in the right direction? We provide a health and safety compliance system specifically for multi-site retailers. Who looks after store compliance or retail operations across your stores?",
  gatekeeper: "If they can’t put you through, ask for the right team or the best time to call back. If they ask what it’s about, say: ‘It’s about how your stores manage safety checks, incidents and corrective actions.’",
  decisionMaker: "Hi, it’s [your name] from HSM App. We help retailers manage store checks, incidents, corrective actions and compliance evidence in one place. Would you have 15 minutes next week to see whether it could help your stores?",
  voicemail: "Hi, it’s [your name] from HSM App. I’m calling about how your stores track safety checks and follow-up actions. You can reach me on [your number]. Thanks.",
  objections: [
    { label: "We already have a system", reply: "Of course. How do stores track an issue from the initial check through to it being resolved? If that already works well, I’ll leave it there." },
    { label: "There’s no budget", reply: "Understood. Is there a better time to revisit it, or would you prefer I leave it with you?" },
    { label: "That’s not my remit", reply: "Thanks for letting me know. Is there a team that looks after store compliance across your sites?" },
    { label: "Send me information", reply: "Happy to. Which would be most useful to see: store checks, incident recording or tracking fixes? Would you like me to follow up, or leave it with you?" },
    { label: "We’re too busy", reply: "I’ll let you get back to it. Is there a better time to call, or would you prefer I leave it there?" },
    { label: "We’re in a contract", reply: "Understood. Do you already have a renewal review planned? If you’d like, I can get back in touch closer to it." },
  ],
};

export function isOutreachStage(stage: Pick<StageSummary, "name" | "terminalType"> | undefined) {
  return stage?.terminalType === "open" && !isResearchStage(stage);
}

export function outreachNumbers(
  company: Pick<OpportunitySummary["company"], "switchboardPhone">,
  contacts: OpportunitySummary["contacts"],
  optedOutNumbers: Iterable<string>,
) {
  function dialable(value: string | null | undefined) {
    const dial = normaliseDialNumber(value);
    return dial && !suppressed.has(phoneKey(dial)!) ? dial : null;
  }
  const suppressed = new Set(optedOutNumbers);
  const numbers = contacts.flatMap((contact) => {
    const dial = dialable(contact.phone);
    return !contact.doNotContact && dial ? [{ contactId: contact.id, label: contact.name, display: contact.phone!, dial }] : [];
  });
  const switchboard = dialable(company.switchboardPhone);
  if (switchboard) numbers.unshift({ contactId: "switchboard", label: "Head office", display: company.switchboardPhone!, dial: switchboard });
  return numbers;
}

export function suppressedPhones(contacts: { doNotContact: boolean; phone: string | null }[]) {
  return contacts.flatMap((contact) => {
    const key = phoneKey(contact.phone);
    return contact.doNotContact && key ? [key] : [];
  });
}

export const outreachCallSchema = z.strictObject({
  attemptId: z.uuid(),
  opportunityId: z.uuid(),
  contactId: z.uuid().nullable(),
  number: z.string().max(80).refine((value) => normaliseDialNumber(value) === value),
  screened: z.literal(true),
  outcome: z.enum(Object.keys(outreachOutcomes) as [keyof typeof outreachOutcomes, ...Array<keyof typeof outreachOutcomes>]),
  notes: z.string().trim().max(10_000),
  objection: z.string().max(120).refine((value) => !value || outreachScripts.objections.some((item) => item.label === value)),
  taskTitle: z.string().trim().max(240).refine((value) => !value || value.length >= 2),
  dueLocal: z.string().max(16),
  timeZone: z.string().max(100).refine((zone) => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }),
  stopScope: z.enum(["contact", "company"]).nullable(),
}).refine((value) =>
  value.outcome === "do_not_contact"
    ? value.stopScope !== null && (value.stopScope === "company" || Boolean(value.contactId)) && !value.taskTitle && !value.dueLocal
    : value.stopScope === null && (value.outcome === "demo_booked"
      ? Boolean(value.dueLocal)
      : Boolean(value.taskTitle) === Boolean(value.dueLocal) && (value.outcome !== "follow_up" || Boolean(value.dueLocal))),
);

export type OutreachCall = z.infer<typeof outreachCallSchema>;

export function outreachCandidate(item: OpportunitySummary, stage: StageSummary | undefined, suppressed: Iterable<string>) {
  if (!stage || !isOutreachStage(stage) || item.archivedAt || item.company.archivedAt || item.company.doNotContact || item.offer?.active === false) return null;
  const contact = item.contacts.find((person) => person.primary && !person.doNotContact)
    ?? item.contacts.find((person) => !person.doNotContact);
  return {
    id: item.id,
    companyId: item.company.id,
    companyName: item.company.name,
    title: item.title,
    stage: stage.name,
    offer: item.offer?.name ?? null,
    contact: contact ? { name: contact.name, title: contact.title, linkedinUrl: contact.linkedinUrl } : null,
    websiteUrl: item.company.websiteUrl,
    linkedinUrl: item.company.linkedinUrl,
    numbers: outreachNumbers(item.company, item.contacts, suppressed),
  };
}

export type OutreachCandidate = NonNullable<ReturnType<typeof outreachCandidate>>;
