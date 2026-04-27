import { NextResponse } from "next/server";

import { scanWordPressSites } from "@/lib/services/site-scan";

export async function GET() {
  try {
    const result = await scanWordPressSites();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-detect failed";
    const status = message === "Sites directory is not mounted." || message === "No WordPress Docker sites found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
