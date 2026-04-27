import { NextResponse } from "next/server";

import { validateSiteSetup } from "@/lib/services/site-validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await validateSiteSetup(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Validation failed" },
      { status: 400 }
    );
  }
}
