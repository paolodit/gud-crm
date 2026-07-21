import path from "node:path";
import { copyFile, cp } from "node:fs/promises";

import { build } from "esbuild";

const root = process.cwd();
const outdir = path.resolve(root, ".next/standalone");

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: false,
  legalComments: "none",
  external: ["pg-native"],
  tsconfig: path.resolve(root, "tsconfig.json"),
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.resolve(root, "scripts/migrate-production.ts")],
    outfile: path.join(outdir, "migrate-production.cjs"),
  }),
  build({
    ...shared,
    entryPoints: [path.resolve(root, "scripts/seed.ts")],
    outfile: path.join(outdir, "seed-production.cjs"),
  }),
]);

await Promise.all([
  cp(path.resolve(root, "drizzle"), path.join(outdir, "drizzle"), { recursive: true }),
  copyFile(path.resolve(root, "scripts/production-entrypoint.mjs"), path.join(outdir, "production-entrypoint.mjs")),
  copyFile(path.resolve(root, "scripts/container-healthcheck.mjs"), path.join(outdir, "container-healthcheck.mjs")),
]);

console.log("Production migration, bootstrap, health and startup utilities bundled into the standalone runtime.");
