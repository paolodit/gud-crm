import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isReviewedInactiveAuthFinding } from "./auth-audit-exceptions.mjs";

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");

function readAudit(extraArgs = []) {
  const args = npmCli ? [npmCli, "audit", "--json", ...extraArgs] : ["audit", "--json", ...extraArgs];
  const result = spawnSync(command, args, { encoding: "utf8", shell: !npmCli && process.platform === "win32" });
  if (!result.stdout) {
    console.error(result.error?.message || result.stderr || "npm audit did not return a report.");
    process.exit(1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error("npm audit returned an unreadable report.");
    process.exit(1);
  }
}

const report = readAudit();
const productionReport = readAudit(["--omit=dev"]);
const lintToolchain = new Set([
  "@eslint-community/eslint-utils",
  "@eslint/config-array",
  "@eslint/eslintrc",
  "@typescript-eslint/eslint-plugin",
  "@typescript-eslint/parser",
  "@typescript-eslint/type-utils",
  "@typescript-eslint/typescript-estree",
  "@typescript-eslint/utils",
  "brace-expansion",
  "eslint",
  "eslint-config-next",
  "eslint-import-resolver-typescript",
  "eslint-plugin-import",
  "eslint-plugin-jsx-a11y",
  "eslint-plugin-react",
  "eslint-plugin-react-hooks",
  "minimatch",
  "typescript-eslint",
]);
const acceptedDevOnly = new Set([
  "@esbuild-kit/core-utils",
  "@esbuild-kit/esm-loader",
  "better-auth",
  "drizzle-kit",
  "esbuild",
  ...lintToolchain,
]);
const authSource = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const reviewedInactiveAuthFindings = Object.entries(report.vulnerabilities ?? {})
  .filter(([name, finding]) => isReviewedInactiveAuthFinding(name, finding, authSource, report.vulnerabilities));
const reviewedNames = new Set(reviewedInactiveAuthFindings.map(([name]) => name));
const vulnerabilities = Object.entries(report.vulnerabilities ?? {}).filter(([name]) => !reviewedNames.has(name));
const unaccepted = vulnerabilities.filter(([name]) => !acceptedDevOnly.has(name));
const esbuildAdvisory = report.vulnerabilities?.esbuild?.via?.find?.((item) => typeof item === "object");
const braceExpansionAdvisory = report.vulnerabilities?.["brace-expansion"]?.via?.find?.((item) => typeof item === "object");
const betterAuthFindingIsOnlyPeerChain = (reviewedNames.has("better-auth") ? [] : report.vulnerabilities?.["better-auth"]?.via ?? [])
  .every((item) => item === "drizzle-kit");
const lintFindingPresent = [...lintToolchain].some((name) => report.vulnerabilities?.[name]);
const lintFindingIsDevOnly = [...lintToolchain].every((name) => !productionReport.vulnerabilities?.[name]);
const acceptedLintFindingIsExpected = !lintFindingPresent
  || (braceExpansionAdvisory?.source === 1124334 && lintFindingIsDevOnly);
const acceptedChainIsExpected = vulnerabilities.every(([name]) => acceptedDevOnly.has(name))
  && (!vulnerabilities.length || esbuildAdvisory?.source === 1102341)
  && betterAuthFindingIsOnlyPeerChain
  && acceptedLintFindingIsExpected;

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

if (reviewedInactiveAuthFindings.length) {
  console.log("Reviewed Better Auth advisories remain in the dependency tree but their required plugins/storage are disabled. Static configuration checks enforce those conditions; unknown advisories still fail. See docs/security-maintenance.md.");
}
if (vulnerabilities.length) {
  const exceptions = [];
  if (esbuildAdvisory?.source === 1102341) exceptions.push("Drizzle Kit's dormant esbuild development-server advisory");
  if (lintFindingPresent) exceptions.push("ESLint's brace-expansion denial-of-service advisory");
  console.log(`Dependency audit passed with ${exceptions.join(" and ")}. The affected development toolchain is not present in the standalone production image. Reviewed configuration-dependent authentication findings are reported separately.`);
} else {
  console.log(reviewedInactiveAuthFindings.length ? "Dependency audit passed with only the explicitly reviewed inactive authentication advisories." : "Dependency audit passed with no known advisories.");
}
