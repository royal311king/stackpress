import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { detectSiteFromCompose } from "@/lib/services/detection";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const site = await prisma.site.findUnique({ where: { id } });

    const siteDirectory = body.siteDirectory ?? site?.siteDirectory;
    if (!siteDirectory) {
      return NextResponse.json({ error: "Site directory is required" }, { status: 400 });
    }

    const result = await detectSiteFromCompose(siteDirectory);

    if (!result) {
      return NextResponse.json({ error: "docker-compose.yml was not found for that site path" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Detection failed" },
      { status: 400 }
    );
  }
}
