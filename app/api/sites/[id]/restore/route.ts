import { NextRequest, NextResponse } from "next/server";

import { runRestore } from "@/lib/services/restore";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const backupId = request.nextUrl.searchParams.get("backupId") ?? undefined;
    await runRestore(id, backupId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Restore failed" },
      { status: 400 }
    );
  }
}
