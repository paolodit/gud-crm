import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
const args = npmCli ? [npmCli, "audit", "--json"] : ["audit", "--json"];
const result = spawnSync(command, args, { encoding: "utf8", shell: !npmCli && process.platform === "win32" });
if (!result.stdout) {
  console.error(result.error?.message || result.stderr || "npm audit did not return a report.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("npm audit returned an unreadable report.");
  process.exit(1);
}

const acceptedDevOnly = new Set([
  "@esbuild-kit/core-utils",
  "@esbuild-kit/esm-loader",
  "better-auth",
  "drizzle-kit",
  "esbuild",
]);
const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
const unaccepted = vulnerabilities.filter(([name]) => !acceptedDevOnly.has(name));
const esbuildAdvisory = report.vulnerabilities?.esbuild?.via?.find?.((item) => typeof item === "object");
const betterAuthFindingIsOnlyPeerChain = (report.vulnerabilities?.["better-auth"]?.via ?? [])
  .every((item) => item === "drizzle-kit");
const acceptedChainIsExpected = vulnerabilities.every(([name]) => acceptedDevOnly.has(name))
  && (!vulnerabilities.length || esbuildAdvisory?.source === 1102341)
  && betterAuthFindingIsOnlyPeerChain;

if (unaccepted.length || !acceptedChainIsExpected) {
  for (const [name, finding] of unaccepted.length ? unaccepted : vulnerabilities) {
    const advisories = (finding.via ?? [])
      .filter((item) => typeof item === "object")
      .map((item) => `${item.title ?? item.name ?? "advisory"} (${item.url ?? "no URL"})`)
      .join("; ");
    console.error(`${name}: ${finding.severity ?? "unknown"}${advisories ? ` — ${advisories}` : ""}`);
    console.error(JSON.stringify({ range: finding.range, via: finding.via, fixAvailable: finding.fixAvailable }, null, 2));
  }
  process.exit(1);
}

if (vulnerabilities.length) {
  console.log("Dependency audit passed with one documented development-only exception: Drizzle Kit carries an old esbuild used by its CLI. GUD CRM does not run or expose esbuild's development server, and Drizzle Kit is not installed in the production image runtime stage.");
} else {
  console.log("Dependency audit passed with no known advisories.");
}
