import { NextResponse } from "next/server";

import { runBackupAllActiveSites } from "@/lib/services/backup-all";

export async function POST() {
  try {
    void runBackupAllActiveSites().catch((error) => {
      console.error("Bulk backup failed", error);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk backup failed" },
      { status: 400 }
    );
  }
}
