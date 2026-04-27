import { NextResponse } from "next/server";

import { detectSiteFromCompose } from "@/lib/services/detection";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await detectSiteFromCompose({
      siteDirectory: body.siteDirectory,
      composePath: body.composePath
    });

    if (!result) {
      return NextResponse.json({ error: "docker-compose.yml was not found for that selected path" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Detection failed" },
      { status: 400 }
    );
  }
}
