import { describe, expect, it } from "vitest";

import { parseResearchImport } from "./research-import";

describe("research import envelope", () => {
  it("keeps legacy array imports compatible and defaults to merge mode", () => {
    const parsed = parseResearchImport([{ name: "Legacy target" }]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.contactMode).toBe("merge");
      expect(parsed.data.targets[0].contacts).toBeUndefined();
    }
  });

  it("accepts omitted contacts in explicit merge mode", () => {
    const parsed = parseResearchImport({ contactMode: "merge", targets: [{ name: "Merge target" }] });
    expect(parsed.success).toBe(true);
  });

  it("rejects replace mode when any target omits contacts", () => {
    const parsed = parseResearchImport({
      contactMode: "replace",
      targets: [{ name: "Complete target", contacts: [] }, { name: "Ambiguous target" }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["targets", 1, "contacts"]);
  });

  it("accepts an explicit empty contact array in replace mode", () => {
    const parsed = parseResearchImport({ contactMode: "replace", targets: [{ name: "Clear target", contacts: [] }] });
    expect(parsed.success).toBe(true);
  });
});
