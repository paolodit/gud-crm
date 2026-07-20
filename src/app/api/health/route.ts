import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { localWorkspaceStatus } from "@/lib/data/local-store";
import { env } from "@/lib/env";

export async function GET() {
  if (env.demoMode) {
    return NextResponse.json({ status: "ok", mode: "demo", database: "not configured" });
  }

  if (env.sqliteMode) {
    try {
      localWorkspaceStatus();
      return NextResponse.json({
        status: "ok",
        mode: "sqlite",
        database: "connected",
      });
    } catch {
      return NextResponse.json(
        { status: "error", mode: "sqlite", database: "unavailable" },
        { status: 503 },
      );
    }
  }

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", mode: "postgres", database: "connected" });
  } catch {
    return NextResponse.json(
      { status: "error", mode: "postgres", database: "unavailable" },
      { status: 503 },
    );
  }
}
