import { describe, expect, it } from "vitest";
import { emailFindingReturnHref, emailFindingSettingsHref } from "./email-finding-links";

const targetId = "51000000-0000-4000-8000-000000000003";

describe("email finding navigation", () => {
  it("opens the email section and preserves the selected target", () => {
    expect(emailFindingSettingsHref(targetId)).toBe(`/settings?tab=ai&section=email-finding&returnTarget=${targetId}#email-finding`);
    expect(emailFindingReturnHref(targetId)).toBe(`/targets?target=${targetId}`);
  });
  it("works without a return target", () => {
    expect(emailFindingSettingsHref()).toBe("/settings?tab=ai&section=email-finding#email-finding");
    expect(emailFindingReturnHref(null)).toBeNull();
  });
  it("rejects arbitrary URLs, paths and injected query parameters", () => {
    for (const value of ["https://example.com", "//example.com", "/targets", "javascript:alert(1)", `${targetId}&next=https://example.com`, ""]) {
      expect(emailFindingReturnHref(value)).toBeNull();
      expect(emailFindingSettingsHref(value)).not.toContain("returnTarget");
    }
  });
});
