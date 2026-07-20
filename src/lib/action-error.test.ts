import { describe, expect, it, vi } from "vitest";

import { publicActionError } from "./action-error";

describe("publicActionError", () => {
  it("keeps short, intentional user-facing messages", () => {
    expect(publicActionError(new Error("That contact is not available."), "Save failed.")).toBe("That contact is not available.");
  });

  it("does not expose database or multiline internals", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(publicActionError(new Error('insert into "users" violated a constraint'), "Save failed.")).toBe("Save failed.");
    expect(publicActionError(new Error("provider failed\n at internal module"), "Save failed.")).toBe("Save failed.");
    consoleError.mockRestore();
  });
});
