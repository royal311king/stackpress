import { NextRequest, NextResponse } from "next/server";

import { runRestore, SafetySnapshotRestoreError } from "@/lib/services/restore";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const backupId = request.nextUrl.searchParams.get("backupId") ?? undefined;
    const body = await request.json().catch(() => null);

    await runRestore(id, backupId, {
      createSafetySnapshot: Boolean(body?.createSafetySnapshot),
      continueWithoutSafetySnapshot: Boolean(body?.continueWithoutSafetySnapshot)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SafetySnapshotRestoreError) {
      return NextResponse.json(
        { error: error.message, snapshotFailure: true },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Restore failed" },
      { status: 400 }
    );
  }
}
