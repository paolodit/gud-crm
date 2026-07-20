"use server";

import { existsSync } from "node:fs";
import path from "node:path";

import { revalidatePath } from "next/cache";
import { publicActionError } from "@/lib/action-error";

import {
  commitTrackerImport,
  commitTrackerImportToLocal,
  previewTrackerImport,
  type TrackerImportReport,
} from "@/lib/import/tracker";
import { getCurrentMember } from "@/lib/session";
import { env } from "@/lib/env";

type ImportResult =
  | { ok: true; alreadyCommitted: boolean; report: TrackerImportReport }
  | { ok: false; error: string };

export async function importLocalTrackerAction(): Promise<ImportResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: "You must be signed in." };
  if (member.role === "member") return { ok: false, error: "An admin or manager must run imports." };
  if (member.demoMode) return { ok: false, error: "Switch to SQLite or PostgreSQL before importing." };

  const filePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.LOCAL_TRACKER_PATH);
  if (!existsSync(filePath)) return { ok: false, error: "The local tracker file is not available." };

  try {
    const preview = await previewTrackerImport(filePath);
    if (preview.invalidRows) return { ok: false, error: `Resolve ${preview.invalidRows} invalid rows before importing.` };
    const result = member.storageMode === "sqlite"
      ? commitTrackerImportToLocal(preview, member.id)
      : await commitTrackerImport(preview, member.organisationId, member.id);
    revalidatePath("/settings");
    revalidatePath("/pipeline");
    revalidatePath("/companies");
    revalidatePath("/my-work");
    revalidatePath("/reports");
    revalidatePath("/search");
    return { ok: true, alreadyCommitted: result.alreadyCommitted, report: result.report as TrackerImportReport };
  } catch (error) {
    return { ok: false, error: publicActionError(error, "The tracker could not be imported.") };
  }
}
