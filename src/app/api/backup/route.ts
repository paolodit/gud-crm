import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalDatabaseBackup } from "@/lib/data/local-store";
import { getCurrentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (member.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  if (member.storageMode !== "sqlite") return Response.json({ error: "Browser database downloads are only available for the local SQLite workspace." }, { status: 409 });

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const fileName = `gud-crm-backup-${stamp}.sqlite`;
  const temporaryPath = path.join(os.tmpdir(), `${crypto.randomUUID()}-${fileName}`);
  try {
    await createLocalDatabaseBackup(temporaryPath);
    const contents = await readFile(temporaryPath);
    return new Response(contents, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
