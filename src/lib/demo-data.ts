import { coreOffer } from "@/lib/domain/offers";
import type {
  ActivitySummary,
  ActivityTypeSummary,
  BoardSnapshot,
  ContactSummary,
  OpportunitySummary,
  OfferSummary,
  PersonSummary,
  StageSummary,
} from "@/lib/domain/types";
import type { EditionKey } from "@/lib/editions";
import { serviceEdition } from "@/lib/editions/service";

const stages: StageSummary[] = [
  ["10000000-0000-4000-8000-000000000001", "Researching", "#0086A8", "open"],
  ["10000000-0000-4000-8000-000000000012", "Research holding", "#7A5AF8", "nurture"],
  ["10000000-0000-4000-8000-000000000002", "Ready to contact", "#579BFC", "open"],
  ["10000000-0000-4000-8000-000000000003", "Outreach active", "#0073EA", "open"],
  ["10000000-0000-4000-8000-000000000005", "Engaged", "#00A86B", "open"],
  ["10000000-0000-4000-8000-000000000006", "Discovery booked", "#00A86B", "open"],
  ["10000000-0000-4000-8000-000000000007", "Trial proposed", "#D98200", "open"],
  ["10000000-0000-4000-8000-000000000008", "Trial active", "#00A86B", "open"],
  ["10000000-0000-4000-8000-000000000011", "Nurture", "#667085", "nurture"],
  ["10000000-0000-4000-8000-000000000009", "Won", "#12805C", "won"],
  ["10000000-0000-4000-8000-000000000010", "Lost", "#D83A52", "lost"],
].map(([id, name, colour, terminalType], position) => ({ id, name, colour, terminalType, position })) as StageSummary[];

const activityTypes: ActivityTypeSummary[] = [
  ["21000000-0000-4000-8000-000000000001", "Followed on LinkedIn", "linkedin", "UserPlus", "#0073EA"],
  ["21000000-0000-4000-8000-000000000002", "Sent LinkedIn connection request", "linkedin", "UserRoundPlus", "#0073EA"],
  ["21000000-0000-4000-8000-000000000003", "Sent LinkedIn DM", "linkedin", "MessageSquare", "#0073EA"],
  ["21000000-0000-4000-8000-000000000004", "Sent email", "email", "Mail", "#0086A8"],
  ["21000000-0000-4000-8000-000000000005", "Called", "phone", "Phone", "#00A86B"],
  ["21000000-0000-4000-8000-000000000006", "Left voicemail", "phone", "Voicemail", "#D98200"],
  ["21000000-0000-4000-8000-000000000007", "Meeting held", "meeting", "CalendarCheck", "#00A86B"],
  ["21000000-0000-4000-8000-000000000008", "Creative or physical touch", "physical", "Package", "#8B5CF6"],
  ["21000000-0000-4000-8000-000000000009", "Sent overview", "email", "FileCheck", "#8B5CF6"],
  ["21000000-0000-4000-8000-000000000010", "Received reply", "email", "Reply", "#00A86B"],
  ["21000000-0000-4000-8000-000000000011", "No response", "note", "CircleSlash", "#667085"],
  ["21000000-0000-4000-8000-000000000012", "Other activity / note", "note", "NotebookPen", "#667085"],
].map(([id, name, channel, icon, colour]) => ({ id, name, channel, icon, colour })) as ActivityTypeSummary[];

const users: PersonSummary[] = [
  { id: "demo-admin", name: "Alex Morgan", email: "alex@example.com", role: "admin", active: true },
  { id: "demo-manager", name: "Sam Lee", email: "sam@example.com", role: "manager", active: true },
  { id: "demo-researcher", name: "Jordan Patel", email: "jordan@example.com", role: "manager", active: true },
  { id: "demo-support", name: "Taylor Reed", email: "taylor@example.com", role: "member", active: true },
];

function contact(id: string, name: string, title: string, primary = true): ContactSummary {
  return { id, name, title, email: null, phone: null, linkedinUrl: null, primary, doNotContact: false };
}

function activity(
  id: string,
  typeIndex: number,
  occurredAt: string,
  notes: string,
  contactItem: ContactSummary | null,
  outcome: string | null = null,
): ActivitySummary {
  return {
    id,
    type: activityTypes[typeIndex],
    contactId: contactItem?.id ?? null,
    contactName: contactItem?.name ?? null,
    outcome,
    notes,
    occurredAt,
    createdAt: occurredAt,
    createdBy: "Alex Morgan",
  };
}

const companies = {
  northstar: { id: "31000000-0000-4000-8000-000000000001", name: "DEMO · Northstar Operations", sector: "Business services", websiteUrl: "https://northstar.example", linkedinUrl: null, fitScore: 5, scaleNote: "Fictional multi-site operator", doNotContact: false },
  brightline: { id: "31000000-0000-4000-8000-000000000002", name: "DEMO · Brightline Group", sector: "Software", websiteUrl: "https://brightline.example", linkedinUrl: null, fitScore: 4, scaleNote: "Fictional growing software team", doNotContact: false },
  harbour: { id: "31000000-0000-4000-8000-000000000003", name: "DEMO · Harbour & Co", sector: "Professional services", websiteUrl: "https://harbour.example", linkedinUrl: null, fitScore: 4, scaleNote: "Fictional regional consultancy", doNotContact: false },
  fieldwork: { id: "31000000-0000-4000-8000-000000000004", name: "DEMO · Fieldwork Services", sector: "Field services", websiteUrl: "https://fieldwork.example", linkedinUrl: null, fitScore: 4, scaleNote: "Fictional distributed service team", doNotContact: false },
  cedar: { id: "31000000-0000-4000-8000-000000000005", name: "DEMO · Cedar Network", sector: "Membership", websiteUrl: "https://cedar.example", linkedinUrl: null, fitScore: 3, scaleNote: "Fictional member organisation", doNotContact: false },
  closed: { id: "31000000-0000-4000-8000-000000000007", name: "DEMO · Lantern Works", sector: "Illustrative account", websiteUrl: null, linkedinUrl: null, fitScore: 3, scaleNote: "Fictional example used to explain a genuine sales loss", doNotContact: false },
};

const contacts = {
  riley: contact("41000000-0000-4000-8000-000000000001", "Riley Chen", "Operations Director"),
  casey: contact("41000000-0000-4000-8000-000000000002", "Casey Brooks", "Commercial Lead", false),
  jamie: contact("41000000-0000-4000-8000-000000000003", "Jamie Shah", "Head of Customer Operations"),
  robin: contact("41000000-0000-4000-8000-000000000004", "Robin Ellis", "Programme Manager"),
  morgan: contact("41000000-0000-4000-8000-000000000006", "Morgan Reed", "Managing Director"),
};

const opportunityRecords: Array<Omit<OpportunitySummary, "offer">> = [
  {
    id: "51000000-0000-4000-8000-000000000001", isExample: true, stageId: stages[4].id, company: companies.northstar,
    title: "Operations platform rollout", priority: "high", temperature: "warm", expectedValue: 24000, probability: 60, expectedCloseDate: "2026-09-30T00:00:00.000Z", owner: users[0],
    outreachAngle: "Use the operational consistency evidence and keep the next ask small.", lastActivityAt: "2026-07-16T14:20:00.000Z", nextActionAt: "2026-07-18T09:30:00.000Z", noNextActionReason: null,
    contacts: [contacts.riley, contacts.casey], activities: [activity("61000000-0000-4000-8000-000000000001", 9, "2026-07-16T14:20:00.000Z", "Riley replied and asked for a concise overview for Casey.", contacts.riley, "Positive reply")],
    tasks: [{ id: "71000000-0000-4000-8000-000000000001", title: "Send the concise overview", dueAt: "2026-07-18T09:30:00.000Z", status: "open", owner: users[0], contactId: contacts.riley.id }], recentChannels: ["email"],
  },
  {
    id: "51000000-0000-4000-8000-000000000002", isExample: true, stageId: stages[3].id, company: companies.brightline,
    title: "Team workflow subscription", priority: "high", temperature: "warm", expectedValue: 12000, probability: 35, expectedCloseDate: "2026-10-15T00:00:00.000Z", owner: users[1],
    outreachAngle: "Lead with the visible workflow gap and a relevant customer outcome.", lastActivityAt: "2026-07-15T08:40:00.000Z", nextActionAt: "2026-07-20T15:00:00.000Z", noNextActionReason: null,
    contacts: [contacts.jamie], activities: [activity("61000000-0000-4000-8000-000000000002", 1, "2026-07-15T08:40:00.000Z", "Connection request sent with a short operational note.", contacts.jamie)],
    tasks: [{ id: "71000000-0000-4000-8000-000000000002", title: "Check the connection and prepare follow-up", dueAt: "2026-07-20T15:00:00.000Z", status: "open", owner: users[1], contactId: contacts.jamie.id }], recentChannels: ["linkedin"],
  },
  {
    id: "51000000-0000-4000-8000-000000000003", isExample: true, stageId: stages[2].id, company: companies.harbour,
    title: "Client operations workspace", priority: "medium", temperature: "cold", expectedValue: 9000, probability: 20, expectedCloseDate: null, owner: users[2],
    outreachAngle: "Personalise around consistent client handoffs and clearer ownership.", lastActivityAt: "2026-07-09T11:00:00.000Z", nextActionAt: null, noNextActionReason: null,
    contacts: [contacts.robin], activities: [activity("61000000-0000-4000-8000-000000000003", 11, "2026-07-09T11:00:00.000Z", "Confirmed Robin as the most credible current route.", contacts.robin)], tasks: [], recentChannels: ["note"],
  },
  {
    id: "51000000-0000-4000-8000-000000000004", isExample: true, stageId: stages[0].id, company: companies.fieldwork,
    title: "Distributed team workflow", priority: "medium", temperature: "cold", expectedValue: null, probability: null, expectedCloseDate: null, owner: users[1],
    outreachAngle: "Validate the strongest operational owner before outreach.", lastActivityAt: null, nextActionAt: "2026-07-22T09:00:00.000Z", noNextActionReason: null,
    contacts: [], activities: [], tasks: [{ id: "71000000-0000-4000-8000-000000000004", title: "Find the operational decision-maker", dueAt: "2026-07-22T09:00:00.000Z", status: "open", owner: users[1], contactId: null }], recentChannels: [],
  },
  {
    id: "51000000-0000-4000-8000-000000000006", isExample: true, stageId: stages[8].id, company: companies.cedar,
    title: "Member service workflow", priority: "low", temperature: "at_risk", expectedValue: 8000, probability: 10, expectedCloseDate: null, owner: users[2],
    outreachAngle: "Keep on watch until the internal programme has an owner and timing.", lastActivityAt: "2026-07-10T16:15:00.000Z", nextActionAt: null, noNextActionReason: "Return when the programme owner is appointed",
    contacts: [], activities: [activity("61000000-0000-4000-8000-000000000006", 11, "2026-07-10T16:15:00.000Z", "Moved to nurture with a specific re-entry trigger.", null)], tasks: [], recentChannels: ["note"],
  },
  {
    id: "51000000-0000-4000-8000-000000000007", isExample: true, stageId: stages[10].id, company: companies.closed,
    title: "DEMO · Closed after a real sales conversation", priority: "low", temperature: "cold", expectedValue: 6000, probability: 0, expectedCloseDate: null, owner: users[0],
    outreachAngle: "This fictional record demonstrates that Lost is reserved for a genuine commercial outcome.", lastActivityAt: "2026-07-11T14:30:00.000Z", nextActionAt: null, noNextActionReason: "The prospect confirmed there is no current project or budget",
    contacts: [contacts.morgan], activities: [activity("61000000-0000-4000-8000-000000000007", 9, "2026-07-11T14:30:00.000Z", "Morgan confirmed the team is not pursuing a change and asked us to close the conversation.", contacts.morgan, "Negative reply")], tasks: [], recentChannels: ["email"],
  },
];

const opportunities: OpportunitySummary[] = opportunityRecords.map((opportunity) => ({ ...opportunity, offer: coreOffer }));

export const demoBoard: BoardSnapshot = {
  edition: "focused",
  pipeline: { id: "01000000-0000-4000-8000-000000000001", name: "Focused Sales" },
  offers: [coreOffer],
  stages,
  opportunities,
  activityTypes,
  users,
  generatedAt: "2026-07-17T09:00:00.000Z",
  demoMode: true,
  storageMode: "demo",
};

const serviceOffers: OfferSummary[] = [
  {
    id: "92000000-0000-4000-8000-000000000001",
    name: "Website project",
    colour: "#6554C0",
    description: "A strategy-led website or digital platform project.",
    idealCustomer: "An organisation with a clear audience, an important change to make and an owner for the project.",
    positioning: "A useful digital platform shaped around the organisation's real goals and users.",
    isDefault: true,
    active: true,
    position: 0,
  },
  {
    id: "92000000-0000-4000-8000-000000000002",
    name: "Growth retainer",
    colour: "#0073EA",
    description: "Ongoing optimisation, content and visibility support.",
    idealCustomer: "A team with an established offer and a recurring need to improve reach or conversion.",
    positioning: "A steady improvement programme with clear priorities, evidence and ownership.",
    isDefault: false,
    active: true,
    position: 1,
  },
  {
    id: "92000000-0000-4000-8000-000000000003",
    name: "Visitor experience",
    colour: "#D98200",
    description: "Interpretation, exhibition or interactive experience design.",
    idealCustomer: "A cultural or public-facing organisation planning a meaningful visitor experience.",
    positioning: "A memorable experience that makes complex stories clear, inviting and useful.",
    isDefault: false,
    active: true,
    position: 2,
  },
];

const serviceDemoProfiles = [
  {
    company: { name: "DEMO · Alder & Stone", sector: "Professional services", scaleNote: "Fictional consultancy with a dated website" },
    title: "Website repositioning project",
    offer: serviceOffers[0],
    value: 18000,
    probability: 60,
    angle: "Use the visible mismatch between the current site and the consultancy's stronger market position.",
  },
  {
    company: { name: "DEMO · Northbank Foods", sector: "Food and hospitality", scaleNote: "Fictional regional food brand" },
    title: "Ongoing growth programme",
    offer: serviceOffers[1],
    value: 24000,
    probability: 35,
    angle: "Lead with a small, measurable visibility opportunity before discussing a retainer.",
  },
  {
    company: { name: "DEMO · Harbour Museum", sector: "Culture and heritage", scaleNote: "Fictional independent museum planning a new gallery" },
    title: "Interactive gallery experience",
    offer: serviceOffers[2],
    value: 72000,
    probability: 20,
    angle: "Show an understanding of the visitor story and propose a short discovery conversation.",
  },
  {
    company: { name: "DEMO · Fieldwork Partners", sector: "Business services", scaleNote: "Fictional distributed advisory team" },
    title: "Website discovery sprint",
    offer: serviceOffers[0],
    value: 6500,
    probability: 15,
    angle: "Validate the commercial owner and the reason for change before shaping a larger project.",
  },
  {
    company: { name: "DEMO · Cedar Foundation", sector: "Charity", scaleNote: "Fictional foundation awaiting a funding decision" },
    title: "Search visibility support",
    offer: serviceOffers[1],
    value: 12000,
    probability: 10,
    angle: "Keep the opportunity quiet until funding and an internal owner are confirmed.",
  },
  {
    company: { name: "DEMO · Lantern Arts", sector: "Arts and culture", scaleNote: "Fictional arts organisation used to demonstrate a genuine loss" },
    title: "DEMO · Closed interpretation project",
    offer: serviceOffers[2],
    value: 42000,
    probability: 0,
    angle: "This fictional record shows that Lost follows a real commercial decision, not desk research.",
  },
] as const;

export const serviceDemoBoard: BoardSnapshot = (() => {
  const snapshot = structuredClone(demoBoard);
  snapshot.edition = "service";
  snapshot.pipeline.name = serviceEdition.pipelineName;
  snapshot.offers = structuredClone(serviceOffers);
  snapshot.stages = snapshot.stages.map((stage, index) => ({
    ...stage,
    name: serviceEdition.stageNames[index] ?? stage.name,
  }));
  snapshot.opportunities = snapshot.opportunities.map((opportunity, index) => {
    const profile = serviceDemoProfiles[index];
    return {
      ...opportunity,
      title: profile.title,
      offer: structuredClone(profile.offer),
      expectedValue: profile.value,
      probability: profile.probability,
      outreachAngle: profile.angle,
      company: {
        ...opportunity.company,
        ...profile.company,
        websiteUrl: `https://service-demo-${index + 1}.example`,
      },
      aiSuggestions: [],
    };
  });
  return snapshot;
})();

export function demoBoardForEdition(edition: EditionKey): BoardSnapshot {
  return structuredClone(edition === "service" ? serviceDemoBoard : demoBoard);
}
