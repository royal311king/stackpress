import { NextResponse } from "next/server";

import { checkSiteHealth } from "@/lib/services/site-health";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await checkSiteHealth(id);

    return NextResponse.json({
      ok: true,
      healthStatus: site.healthStatus,
      healthStatusCode: site.healthStatusCode,
      healthResponseTimeMs: site.healthResponseTimeMs,
      healthCheckedAt: site.healthCheckedAt,
      healthError: site.healthError
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Health check failed" },
      { status: 400 }
    );
  }
}
