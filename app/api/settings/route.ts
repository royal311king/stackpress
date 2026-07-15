import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/validators";
import { logActivity } from "@/lib/services/logging";
import fs from "node:fs";
import path from "node:path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = settingsSchema.parse(body);
    for (const [label, value] of [["Backup Root", parsed.backupRoot], ["WordPress Sites Root", parsed.sitesRoot]] as const) {
      const resolved = path.resolve(value);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return NextResponse.json({ error: `${label} does not exist. Create it before saving.` }, { status: 400 });
      }
    }

    const settings = await prisma.appSetting.upsert({
      where: { id: "singleton" },
      update: { ...parsed, defaultBackupRoot: parsed.backupRoot },
      create: {
        id: "singleton",
        ...parsed,
        defaultBackupRoot: parsed.backupRoot
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
