import fs from "node:fs";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const backup = await prisma.backupJob.findUnique({
      where: { id },
      include: { site: true }
    });

    if (!backup) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }

    for (const file of [backup.dbDumpPath, backup.filesArchivePath, backup.manifestPath]) {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    await prisma.backupJob.delete({ where: { id } });
    await logActivity("backup", `Backup deleted for ${backup.site.name}`, "warn", {
      siteId: backup.siteId,
      backupId: backup.id
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 400 }
    );
  }
}
