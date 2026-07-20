import { NextRequest, NextResponse } from "next/server";

import { AdminAuthorizationError, requireStackPressAdmin } from "@/lib/auth/admin";
import { cloudConnectionService } from "@/lib/services/cloud-storage/connections";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireStackPressAdmin(request);
    const { id } = await params;
    return NextResponse.json({ connection: await cloudConnectionService.disable(id) });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to disable connection" },
      { status: 400 }
    );
  }
}
