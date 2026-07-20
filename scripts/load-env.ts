import { existsSync } from "node:fs";
import path from "node:path";

// Node's native parser keeps secrets out of package dependencies. Local overrides win
// because loadEnvFile does not replace values already present in process.env.
for (const fileName of [".env.local", ".env"]) {
  const filePath = path.resolve(process.cwd(), fileName);
  if (existsSync(filePath)) process.loadEnvFile(filePath);
}
