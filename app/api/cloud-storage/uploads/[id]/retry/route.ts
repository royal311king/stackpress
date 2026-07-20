import { NextResponse } from "next/server";

import { retryCloudUpload } from "@/lib/services/cloud-storage/upload-jobs";
import { AdminAuthorizationError, requireStackPressAdmin } from "@/lib/auth/admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireStackPressAdmin(request);
    const { id } = await params;
    return NextResponse.json({ upload: await retryCloudUpload(id) }, { status: 202 });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retry cloud upload" },
      { status: 400 }
    );
  }
}
