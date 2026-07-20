import { NextRequest, NextResponse } from "next/server";

import { AdminAuthorizationError, requireStackPressAdmin } from "@/lib/auth/admin";
import {
  deleteRemoteCopy,
  downloadRemoteCopy,
  verifyRemoteCopy
} from "@/lib/services/cloud-storage/remote-copies";
import { enqueueRemoteRestore } from "@/lib/services/cloud-storage/remote-restore-jobs";

export async function POST(request: NextRequest, { params }: {
  params: Promise<{ id: string; connectionId: string; action: string }>;
}) {
  try {
    requireStackPressAdmin(request);
    const { id, connectionId, action } = await params;
    if (action === "verify") return NextResponse.json({ verified: await verifyRemoteCopy(id, connectionId) });
    if (action === "download") return NextResponse.json({ download: await downloadRemoteCopy(id, connectionId) });
    if (action === "delete") {
      await deleteRemoteCopy(id, connectionId);
      return NextResponse.json({ ok: true });
    }
    if (action === "restore") {
      return NextResponse.json({ restoreJob: await enqueueRemoteRestore(id, connectionId) }, { status: 202 });
    }
    return NextResponse.json({ error: "Unsupported remote backup action" }, { status: 404 });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remote backup action failed" },
      { status: 400 }
    );
  }
}
