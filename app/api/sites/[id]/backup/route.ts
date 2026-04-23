import { NextResponse } from "next/server";

import { runBackup } from "@/lib/services/backup";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    void runBackup(id, "manual").catch((error) => {
      console.error("Manual backup failed", error);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup failed" },
      { status: 400 }
    );
  }
}
