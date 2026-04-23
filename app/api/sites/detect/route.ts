import { NextRequest, NextResponse } from "next/server";

import { detectSiteFromCompose } from "@/lib/services/detection";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await detectSiteFromCompose(body.siteDirectory);

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
