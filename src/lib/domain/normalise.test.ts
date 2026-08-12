import { describe, expect, it } from "vitest";

import { extractDomain, isSafeHttpUrl, normaliseHttpUrlInput, safeExternalUrl } from "./normalise";

describe("external URL safety", () => {
  it("allows complete HTTP and HTTPS links", () => {
    expect(isSafeHttpUrl("https://example.com/path")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000")).toBe(true);
    expect(safeExternalUrl(" https://example.com/path ")).toBe("https://example.com/path");
  });

  it("rejects executable and data URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(document.domain)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
  });

  it("extracts only web domains", () => {
    expect(extractDomain("example.com")).toBe("example.com");
    expect(extractDomain("https://www.example.com/a")).toBe("example.com");
    expect(extractDomain("javascript:alert(1)")).toBeNull();
  });

  it("turns a bare domain into a safe HTTPS URL without disguising unsafe schemes", () => {
    expect(normaliseHttpUrlInput("example.com/about")).toBe("https://example.com/about");
    expect(normaliseHttpUrlInput(" https://example.com ")).toBe("https://example.com");
    expect(normaliseHttpUrlInput("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(isSafeHttpUrl(normaliseHttpUrlInput("javascript:alert(1)"))).toBe(false);
  });
});
