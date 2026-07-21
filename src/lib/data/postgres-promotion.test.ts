import { describe, expect, it } from "vitest";

import { demoBoardForEdition } from "@/lib/demo-data";
import { buildPostgresPromotionSql } from "@/lib/data/postgres-promotion";

describe("PostgreSQL promotion export", () => {
  it("builds one guarded transaction with reconciliable fictional records", () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.pipeline.name = "O'Brien DEMO pipeline";
    const result = buildPostgresPromotionSql(snapshot, {
      administratorEmail: "alex@example.com",
      organisationName: "DEMO Service Sales",
      aiEnabled: true,
    });

    expect(result.manifest.opportunities).toBe(snapshot.opportunities.length);
    expect(result.manifest.companies).toBe(snapshot.opportunities.length);
    expect(result.sql).toContain("Target workspace is not empty");
    expect(result.sql).toContain("O''Brien DEMO pipeline");
    expect(result.sql).toContain("workspace.promoted_from_sqlite");
    expect(result.sql).toContain("BEGIN;");
    expect(result.sql).toContain("COMMIT;");
  });
});
