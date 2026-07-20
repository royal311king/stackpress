import { NextRequest, NextResponse } from "next/server";

import {
  AdminAuthorizationError,
  requireStackPressAdmin
} from "@/lib/auth/admin";
import { cloudConnectionService } from "@/lib/services/cloud-storage/connections";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireStackPressAdmin(request);
    const { id } = await params;
    const connection = await cloudConnectionService.get(id);
    if (connection.provider !== "google_drive") {
      return NextResponse.json({ error: "Connection is not a Google Drive account" }, { status: 400 });
    }
    return NextResponse.json(await cloudConnectionService.disconnect(id));
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.status === 401
            ? { "WWW-Authenticate": 'Basic realm="StackPress Administrator"' }
            : undefined
        }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to disconnect Google Drive" },
      { status: 400 }
    );
  }
}
