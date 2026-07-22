import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "manager", "member"]);
export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const temperature = pgEnum("temperature", ["cold", "warm", "hot", "at_risk", "unresponsive"]);
export const terminalType = pgEnum("terminal_type", ["open", "won", "lost", "nurture"]);
export const taskStatus = pgEnum("task_status", ["open", "completed", "cancelled"]);
export const activityChannel = pgEnum("activity_channel", [
  "linkedin",
  "email",
  "phone",
  "meeting",
  "physical",
  "note",
]);
export const aiFeedbackRating = pgEnum("ai_feedback_rating", [
  "useful",
  "not_useful",
  "already_tried",
]);
export const importStatus = pgEnum("import_status", ["previewed", "committed", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  aiEnabled: boolean("ai_enabled").default(false).notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
});

// Better Auth core schema, extended with the CRM's organisation boundary and role.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    role: userRole("role").default("member").notNull(),
    active: boolean("active").default(true).notNull(),
    banned: boolean("banned").default(false).notNull(),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_organisation_idx").on(table.organisationId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("accounts_user_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 220 }).notNull(),
    normalisedName: varchar("normalised_name", { length: 220 }).notNull(),
    domain: varchar("domain", { length: 255 }),
    normalisedDomain: varchar("normalised_domain", { length: 255 }),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    storeCount: integer("store_count"),
    scaleNote: text("scale_note"),
    sector: varchar("sector", { length: 160 }),
    ownership: varchar("ownership", { length: 160 }),
    fitScore: integer("fit_score"),
    researchNote: text("research_note"),
    sourceUrls: jsonb("source_urls").$type<string[]>().default([]).notNull(),
    legitimateInterestReason: text("legitimate_interest_reason"),
    doNotContact: boolean("do_not_contact").default(false).notNull(),
    importMetadata: jsonb("import_metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("companies_org_name_unique").on(table.organisationId, table.normalisedName),
    uniqueIndex("companies_org_domain_unique").on(table.organisationId, table.normalisedDomain),
    index("companies_search_idx").on(table.organisationId, table.name),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 220 }).notNull(),
    normalisedName: varchar("normalised_name", { length: 220 }).notNull(),
    title: varchar("title", { length: 255 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 80 }),
    linkedinUrl: text("linkedin_url"),
    source: text("source"),
    sourceUrls: jsonb("source_urls").$type<string[]>().default([]).notNull(),
    preferredChannel: activityChannel("preferred_channel"),
    doNotContact: boolean("do_not_contact").default(false).notNull(),
    importMetadata: jsonb("import_metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("contacts_org_email_unique").on(table.organisationId, table.email),
    index("contacts_company_idx").on(table.companyId),
    index("contacts_linkedin_idx").on(table.organisationId, table.linkedinUrl),
  ],
);

export const pipelines = pgTable(
  "pipelines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("pipelines_org_name_unique").on(table.organisationId, table.name)],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    normalisedName: varchar("normalised_name", { length: 160 }).notNull(),
    colour: varchar("colour", { length: 16 }).notNull(),
    description: text("description").default("").notNull(),
    idealCustomer: text("ideal_customer").default("").notNull(),
    positioning: text("positioning").default("").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("offers_org_name_unique").on(table.organisationId, table.normalisedName),
    index("offers_org_active_position_idx").on(table.organisationId, table.active, table.position),
  ],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    colour: varchar("colour", { length: 16 }).notNull(),
    position: integer("position").notNull(),
    terminalType: terminalType("terminal_type").default("open").notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stages_pipeline_position_unique").on(table.pipelineId, table.position),
    index("stages_pipeline_idx").on(table.pipelineId),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "restrict" }),
    position: integer("position").default(0).notNull(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 220 }).notNull(),
    priority: priority("priority").default("medium").notNull(),
    temperature: temperature("temperature").default("cold").notNull(),
    value: numeric("value", { precision: 12, scale: 2 }),
    probability: integer("probability"),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    outreachAngle: text("outreach_angle"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    noNextActionReason: text("no_next_action_reason"),
    closedReason: text("closed_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    importMetadata: jsonb("import_metadata").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("opportunities_board_idx").on(table.organisationId, table.pipelineId, table.stageId, table.position),
    index("opportunities_offer_stage_idx").on(table.organisationId, table.offerId, table.stageId),
    index("opportunities_owner_due_idx").on(table.ownerId, table.nextActionAt),
  ],
);

export const researchThemes = pgTable(
  "research_themes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => offers.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 220 }).notNull(),
    audience: text("audience"),
    problem: text("problem"),
    signal: text("signal"),
    angle: text("angle"),
    status: varchar("status", { length: 24 }).default("idea").notNull(),
    sourceUrls: jsonb("source_urls").$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (table) => [index("research_themes_org_status_idx").on(table.organisationId, table.status, table.updatedAt)],
);

export const opportunityContacts = pgTable(
  "opportunity_contacts",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 160 }),
    primary: boolean("primary").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("opportunity_contacts_unique").on(table.opportunityId, table.contactId),
    index("opportunity_contacts_contact_idx").on(table.contactId),
  ],
);

export const stageHistory = pgTable(
  "stage_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => stages.id, { onDelete: "set null" }),
    toStageId: uuid("to_stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "restrict" }),
    movedById: text("moved_by_id").references(() => users.id, { onDelete: "set null" }),
    movedAt: timestamp("moved_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("stage_history_opportunity_idx").on(table.opportunityId, table.movedAt)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    colour: varchar("colour", { length: 16 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("tags_org_name_unique").on(table.organisationId, table.name)],
);

export const opportunityTags = pgTable(
  "opportunity_tags",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("opportunity_tags_unique").on(table.opportunityId, table.tagId)],
);

export const activityTypes = pgTable(
  "activity_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 140 }).notNull(),
    channel: activityChannel("channel").notNull(),
    icon: varchar("icon", { length: 80 }).notNull(),
    colour: varchar("colour", { length: 16 }).notNull(),
    active: boolean("active").default(true).notNull(),
    builtIn: boolean("built_in").default(false).notNull(),
    metadataSchema: jsonb("metadata_schema").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [uniqueIndex("activity_types_org_name_unique").on(table.organisationId, table.name)],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    activityTypeId: uuid("activity_type_id")
      .notNull()
      .references(() => activityTypes.id, { onDelete: "restrict" }),
    outcome: varchar("outcome", { length: 220 }),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("activities_timeline_idx").on(table.opportunityId, table.occurredAt),
    index("activities_company_idx").on(table.companyId),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: varchar("mime_type", { length: 160 }).notNull(),
    size: integer("size").notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("attachments_storage_key_unique").on(table.storageKey)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: varchar("title", { length: 240 }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: taskStatus("status").default("open").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: varchar("source", { length: 80 }).default("manual").notNull(),
    ...timestamps,
  },
  (table) => [
    index("tasks_owner_due_idx").on(table.organisationId, table.ownerId, table.status, table.dueAt),
    index("tasks_opportunity_idx").on(table.opportunityId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 160 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_entity_idx").on(table.entityType, table.entityId, table.createdAt)],
);

export const playbookItems = pgTable("playbook_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 80 }).notNull(),
  title: varchar("title", { length: 220 }).notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
});

export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  channel: activityChannel("channel").notNull(),
  audience: varchar("audience", { length: 160 }),
  stageId: uuid("stage_id").references(() => stages.id, { onDelete: "set null" }),
  title: varchar("title", { length: 220 }).notNull(),
  body: text("body").notNull(),
  active: boolean("active").default(true).notNull(),
  ...timestamps,
});

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    suggestionType: varchar("suggestion_type", { length: 120 }).notNull(),
    output: jsonb("output").$type<Record<string, unknown>>().notNull(),
    contextReferences: jsonb("context_references").$type<Record<string, string[]>>().default({}).notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    generatedById: text("generated_by_id").references(() => users.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_suggestions_opportunity_idx").on(table.opportunityId, table.generatedAt)],
);

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    suggestionId: uuid("suggestion_id")
      .notNull()
      .references(() => aiSuggestions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: aiFeedbackRating("rating").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("ai_feedback_user_suggestion_unique").on(table.suggestionId, table.userId)],
);

export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  checksum: varchar("checksum", { length: 128 }).notNull(),
  status: importStatus("status").default("previewed").notNull(),
  report: jsonb("report").$type<Record<string, unknown>>().default({}).notNull(),
  createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    entityId: text("entity_id"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    errors: jsonb("errors").$type<string[]>().default([]).notNull(),
  },
  (table) => [uniqueIndex("import_rows_source_unique").on(table.importId, table.sourceRow)],
);

export const authSchema = { users, sessions, accounts, verifications };
