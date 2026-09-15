import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { localWorkspaceStatus } from "@/lib/data/local-store";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const revision = process.env.GUD_BUILD_REVISION ?? "local";
  if (env.demoMode) {
    return NextResponse.json({ status: "ok", mode: "demo", database: "not configured", revision }, { headers });
  }

  if (env.sqliteMode) {
    try {
      localWorkspaceStatus();
      return NextResponse.json({
        status: "ok",
        mode: "sqlite",
        database: "connected",
        revision,
      }, { headers });
    } catch {
      return NextResponse.json(
        { status: "error", mode: "sqlite", database: "unavailable" },
        { status: 503, headers },
      );
    }
  }

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", mode: "postgres", database: "connected", revision }, { headers });
  } catch {
    return NextResponse.json(
      { status: "error", mode: "postgres", database: "unavailable" },
      { status: 503, headers },
    );
  }
}
