import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/validators";
import { logActivity } from "@/lib/services/logging";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = settingsSchema.parse(body);

    const settings = await prisma.appSetting.upsert({
      where: { id: "singleton" },
      update: parsed,
      create: {
        id: "singleton",
        ...parsed
      }
    });

    await logActivity("settings", "Application settings updated", "info");

    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settings update failed" },
      { status: 400 }
    );
  }
}
