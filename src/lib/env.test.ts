import { describe, expect, it } from "vitest";

import { resolveOpenAiApiKey } from "./env";

describe("OpenAI environment compatibility", () => {
  it("prefers the canonical OPENAI_API_KEY", () => {
    expect(resolveOpenAiApiKey({ OPENAI_API_KEY: " canonical ", OPEN_API_KEY: "legacy" })).toBe("canonical");
  });

  it("accepts the legacy OPEN_API_KEY used by early self-hosted installs", () => {
    expect(resolveOpenAiApiKey({ OPEN_API_KEY: " legacy " })).toBe("legacy");
  });

  it("does not treat blank values as configured", () => {
    expect(resolveOpenAiApiKey({ OPENAI_API_KEY: " ", OPEN_API_KEY: "" })).toBeUndefined();
  });
});
