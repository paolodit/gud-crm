import { defineConfig } from "drizzle-kit";

import "./scripts/load-env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://gud:gud@localhost:5432/gud_crm",
  },
  strict: true,
  verbose: true,
});
