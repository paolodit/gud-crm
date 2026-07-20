export type Channel = "linkedin" | "email" | "phone" | "meeting" | "physical" | "note";
export type Priority = "low" | "medium" | "high" | "critical";
export type Temperature = "cold" | "warm" | "hot" | "at_risk" | "unresponsive";
export type StorageMode = "demo" | "sqlite" | "postgres";
export type EditionKey = "focused" | "service";
export type AIFeedbackRating = "useful" | "not_useful" | "already_tried";
export type AICoachMode = "coach" | "draft" | "creative" | "recovery";
export type SalesAssetStatus = "ready" | "in_progress" | "missing" | "untracked";
export type SalesAssetId = "website" | "walkthrough" | "playable_demo" | "benefits_pdf" | "qualifier" | "compliance_research";

export type SalesAssetSummary = {
  id: SalesAssetId;
  status: SalesAssetStatus;
  url: string;
  note: string;
};

export type OfferSummary = {
  id: string;
  name: string;
  colour: string;
  description: string;
  idealCustomer: string;
  positioning: string;
  isDefault: boolean;
  active: boolean;
  position: number;
};

export type AICoachOutput = {
  summary: string;
  nextActions: Array<{
    title: string;
    reason: string;
    timing: string;
    confidence: "low" | "medium" | "high";
  }>;
  drafts: Array<{
    channel: "linkedin" | "email" | "call" | "letter";
    text: string;
  }>;
  creativeIdeas: Array<{
    level: "sensible" | "distinctive" | "bold";
    idea: string;
    reason: string;
    costBand: string;
  }>;
  warnings: string[];
};

export type AISuggestionSummary = {
  id: string;
  opportunityId: string;
  suggestionType: AICoachMode;
  output: AICoachOutput;
  contextReferences: Record<string, string[]>;
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  generatedAt: string;
  feedbackRating: AIFeedbackRating | null;
};

export type PersonSummary = {
  id: string;
  name: string;
  email?: string | null;
  image?: string | null;
  role?: "admin" | "manager" | "member";
  active?: boolean;
};

export type CompanySummary = {
  id: string;
  name: string;
  sector: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  fitScore: number | null;
  scaleNote: string | null;
  doNotContact: boolean;
  researchNote?: string | null;
  sourceUrls?: string[];
  linkedinPeopleSearchUrl?: string | null;
  idealBuyerRoles?: string | null;
  priorityReason?: string | null;
};

export type ContactSummary = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  primary: boolean;
  preferredChannel?: Channel | null;
  doNotContact: boolean;
  sourceUrls?: string[];
};

export type ActivityTypeSummary = {
  id: string;
  name: string;
  channel: Channel;
  icon: string;
  colour: string;
};

export type ActivitySummary = {
  id: string;
  type: ActivityTypeSummary;
  contactId: string | null;
  contactName: string | null;
  outcome: string | null;
  notes: string | null;
  occurredAt: string;
  createdAt: string;
  createdBy: string;
};

export type TaskSummary = {
  id: string;
  title: string;
  dueAt: string;
  status: "open" | "completed" | "cancelled";
  owner: PersonSummary | null;
  contactId: string | null;
};

export type OpportunitySummary = {
  id: string;
  isExample?: boolean;
  stageId: string;
  offer: OfferSummary | null;
  company: CompanySummary;
  title: string;
  priority: Priority;
  temperature: Temperature;
  expectedValue?: number | null;
  probability?: number | null;
  expectedCloseDate?: string | null;
  owner: PersonSummary | null;
  outreachAngle: string | null;
  lastActivityAt: string | null;
  nextActionAt: string | null;
  noNextActionReason: string | null;
  contacts: ContactSummary[];
  activities: ActivitySummary[];
  tasks: TaskSummary[];
  recentChannels: Channel[];
  aiSuggestions?: AISuggestionSummary[];
};

export type StageSummary = {
  id: string;
  name: string;
  colour: string;
  position: number;
  terminalType: "open" | "won" | "lost" | "nurture";
};

export type BoardSnapshot = {
  edition: EditionKey;
  pipeline: { id: string; name: string };
  offers: OfferSummary[];
  stages: StageSummary[];
  opportunities: OpportunitySummary[];
  activityTypes: ActivityTypeSummary[];
  users: PersonSummary[];
  generatedAt: string;
  demoMode: boolean;
  storageMode: StorageMode;
};
