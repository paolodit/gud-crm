import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
const files = output.toString("utf8").split("\0").filter(Boolean);
const blockedExtensions = new Set([".csv", ".db", ".ods", ".sqlite", ".sqlite3", ".tsv", ".xlsx", ".xls"]);
const errors = [];

for (const file of files) {
  const normalised = file.replaceAll("\\", "/");
  const extension = path.extname(normalised).toLowerCase();
  if (normalised.startsWith("data/") || (normalised.startsWith("uploads/") && normalised !== "uploads/.gitkeep") || normalised === "config/instances.local.json") {
    errors.push(`${normalised}: private runtime path must not be tracked`);
  }
  if (blockedExtensions.has(extension)) errors.push(`${normalised}: private data file type must not be tracked`);

  let contents;
  try {
    contents = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue;
  }
  if (contents.includes("\0")) continue;

  const emails = contents.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    const domain = email.split("@")[1].toLowerCase();
    const safe = domain === "example.com" || domain.endsWith(".example") || domain.endsWith(".test");
    if (!safe) errors.push(`${normalised}: non-placeholder email address ${email}`);
  }
}

if (errors.length) {
  console.error("Privacy audit failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Privacy audit passed across ${files.length} public-code files. Runtime databases, workbooks and non-placeholder email addresses are absent.`);
