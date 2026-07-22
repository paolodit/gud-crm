import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: z.enum(["true", "false"]).optional(),
  DATA_BACKEND: z.enum(["demo", "sqlite", "postgres"]).optional(),
  SQLITE_PATH: z.string().default("data/gud-crm.db"),
  GUD_DEFAULT_MODEL: z.enum(["focused", "service"]).optional(),
  GUD_DEFAULT_EDITION: z.enum(["focused", "service"]).optional(),
  GUD_INSTANCE_NAME: z.string().trim().min(1).max(80).default("Local sales workspace"),
  LOCAL_TRACKER_PATH: z.string().default("data/imports/outreach-tracker.xlsx"),
  AI_ENABLED: z.enum(["true", "false"]).default("true"),
  AI_PROVIDER: z.enum(["local", "openai"]).default("local"),
  AI_MODEL: z.string().default("gpt-5.6-luna"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  AI_RATE_LIMIT: z.coerce.number().int().min(1).max(30).default(6),
  OPENAI_API_KEY: z.string().optional(),
  HUNTER_API_KEY: z.string().optional(),
  VOILA_NORBERT_API_KEY: z.string().optional(),
  HUNTER_FREE_MONTHLY_LIMIT: z.coerce.number().int().min(0).max(100_000).default(50),
  NORBERT_FREE_LIFETIME_LIMIT: z.coerce.number().int().min(0).max(100_000).default(50),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  AUTH_FROM_EMAIL: z.string().min(3).optional(),
  GUD_VERSION: z.string().trim().min(1).max(80).default("0.1.0"),
  GUD_BACKUP_WEBHOOK_URL: z.string().url().optional(),
  GUD_DEPLOY_WEBHOOK_URL: z.string().url().optional(),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
}

const values = parsed.data;
const storageMode = values.DATA_BACKEND ??
  (values.DEMO_MODE === "true" ? "demo" : values.DATABASE_URL ? "postgres" : "sqlite");

if (storageMode === "postgres" && !values.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when DATA_BACKEND=postgres.");
}

if (storageMode === "postgres" && !values.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is required when DATA_BACKEND=postgres.");
}

if (values.NODE_ENV === "production" && storageMode === "postgres") {
  if (!values.BETTER_AUTH_URL || !process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error("BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL are required for a production PostgreSQL deployment.");
  }
  const authUrl = new URL(values.BETTER_AUTH_URL);
  const appUrl = new URL(values.NEXT_PUBLIC_APP_URL);
  const localProductionCheck = [authUrl.hostname, appUrl.hostname].every((host) => host === "localhost" || host === "127.0.0.1");
  if (!localProductionCheck && (authUrl.protocol !== "https:" || appUrl.protocol !== "https:")) {
    throw new Error("Production authentication URLs must use HTTPS.");
  }
  if (authUrl.origin !== appUrl.origin) {
    throw new Error("BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL must use the same trusted origin.");
  }
}

export const env = {
  ...values,
  storageMode,
  demoMode: storageMode === "demo",
  sqliteMode: storageMode === "sqlite",
  postgresMode: storageMode === "postgres",
  defaultEdition: values.GUD_DEFAULT_MODEL ?? values.GUD_DEFAULT_EDITION ?? "focused",
  instanceName: values.GUD_INSTANCE_NAME,
  aiEnabled: values.AI_ENABLED === "true",
  databaseUrl:
    values.DATABASE_URL ?? "postgresql://gud:gud@localhost:5432/gud_crm",
  authSecret:
    values.BETTER_AUTH_SECRET ??
    "development-only-secret-change-before-real-auth-use",
  authEmailConfigured: Boolean(values.RESEND_API_KEY && values.AUTH_FROM_EMAIL),
  hunterConfigured: Boolean(values.HUNTER_API_KEY),
  norbertConfigured: Boolean(values.VOILA_NORBERT_API_KEY),
  companiesHouseConfigured: Boolean(values.COMPANIES_HOUSE_API_KEY),
  googleMapsConfigured: Boolean(values.GOOGLE_MAPS_API_KEY),
  authUsesHttps: new URL(values.BETTER_AUTH_URL ?? values.NEXT_PUBLIC_APP_URL).protocol === "https:",
};
