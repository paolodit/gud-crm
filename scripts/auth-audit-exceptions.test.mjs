import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unaffectedAuthConfiguration, isReviewedInactiveAuthFinding } from "./auth-audit-exceptions.mjs";

const source = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const finding = { via: [{ url: "https://github.com/advisories/GHSA-44jh-23m7-hpcf" }] };
test("the deployed plugin list and explicit memory rate limiter satisfy the reviewed conditions", () => {
  assert.equal(unaffectedAuthConfiguration(source), true);
  assert.equal(isReviewedInactiveAuthFinding("@better-auth/drizzle-adapter", finding, source), true);
});
test("database rate limiting, added plugins, dynamic options and new advisories fail closed", () => {
  for (const changed of [
    source.replace('storage: "memory"', 'storage: "database"'),
    source.replace('plugins: [', 'plugins: [magicLink(),'),
    source.replace('plugins: [', 'plugins: [oauthProxy(),'),
    source.replace('plugins: [', 'plugins: [deviceAuthorization(),'),
    source.replace('plugins: [', 'socialProviders: {}, plugins: ['),
    source.replace('plugins: [', '...extraOptions, plugins: ['),
  ]) assert.equal(unaffectedAuthConfiguration(changed), false);
  assert.equal(isReviewedInactiveAuthFinding("better-auth", { via: [{ url: "https://github.com/advisories/UNKNOWN" }] }, source), false);
  assert.equal(isReviewedInactiveAuthFinding("unrelated-package", finding, source), false);
  assert.equal(isReviewedInactiveAuthFinding("better-auth", { via: ["another-package"] }, source), false);
  const parent = { via: ["@better-auth/drizzle-adapter"] };
  assert.equal(isReviewedInactiveAuthFinding("better-auth", parent, source, { "@better-auth/drizzle-adapter": finding }), true);
  assert.equal(isReviewedInactiveAuthFinding("better-auth", parent, source, { "@better-auth/drizzle-adapter": { via: [{ url: "unknown" }] } }), false);
});
