import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { enqueueCloudUpload } from "@/lib/services/cloud-storage/upload-jobs";
import { AdminAuthorizationError, requireStackPressAdmin } from "@/lib/auth/admin";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uploads = await prisma.cloudUploadJob.findMany({
    where: { backupId: id },
    orderBy: { createdAt: "asc" }
  });
  return NextResponse.json({ uploads });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireStackPressAdmin(request);
    const { id } = await params;
    const body = await request.json() as { cloudConnectionId?: string };
    if (!body.cloudConnectionId) {
      return NextResponse.json({ error: "cloudConnectionId is required" }, { status: 400 });
    }
    const upload = await enqueueCloudUpload(id, body.cloudConnectionId);
    return NextResponse.json({ upload }, { status: upload.status === "queued" ? 202 : 200 });
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to queue cloud upload" },
      { status: 400 }
    );
  }
}
