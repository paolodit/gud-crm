import { describe, expect, it } from "vitest";

import { isActivityTimeAllowed } from "@/lib/domain/activity";

describe("activity timestamps", () => {
  it("checks against the time of the request instead of the time the server started", () => {
    const serverStarted = Date.UTC(2026, 6, 22, 9);
    const requestTime = Date.UTC(2026, 6, 27, 14, 40);

    expect(isActivityTimeAllowed(new Date(requestTime), requestTime)).toBe(true);
    expect(isActivityTimeAllowed(new Date(requestTime + 6 * 60 * 1000), requestTime)).toBe(false);
    expect(isActivityTimeAllowed(new Date(requestTime), serverStarted)).toBe(false);
  });
});
