import fs from "node:fs";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { requiredBackupArtifactKinds } from "@/lib/services/cloud-storage/types";

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

    const activeUpload = await prisma.cloudUploadJob.findFirst({
      where: { backupId: backup.id, status: { in: ["queued", "running"] } }
    });
    if (activeUpload) {
      return NextResponse.json(
        { error: "This local backup is protected while a cloud upload is queued or running" },
        { status: 409 }
      );
    }

    for (const file of [backup.dbDumpPath, backup.filesArchivePath, backup.manifestPath]) {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    const verifiedRemoteFiles = await prisma.cloudBackupFile.findMany({
      where: {
        backupId: backup.id,
        uploadStatus: "success",
        verificationStatus: "verified",
        verifiedAt: { not: null },
        remoteFileId: { not: null }
      },
      select: { cloudConnectionId: true, artifactKind: true }
    });
    const requiredKinds = requiredBackupArtifactKinds(backup.backupType);
    const verifiedKindsByConnection = new Map<string, Set<string>>();
    for (const file of verifiedRemoteFiles) {
      const kinds = verifiedKindsByConnection.get(file.cloudConnectionId) ?? new Set<string>();
      kinds.add(file.artifactKind);
      verifiedKindsByConnection.set(file.cloudConnectionId, kinds);
    }
    const hasCompleteVerifiedRemoteCopy = [...verifiedKindsByConnection.values()]
      .some((kinds) => requiredKinds.every((kind) => kinds.has(kind)));
    if (hasCompleteVerifiedRemoteCopy) {
      await prisma.backupJob.update({
        where: { id },
        data: {
          dbDumpPath: null,
          filesArchivePath: null,
          manifestPath: null,
          totalBytes: 0n,
          progressStep: "local-deleted",
          logExcerpt: "Local files deleted; remote copy retained"
        }
      });
    } else {
      await prisma.backupJob.delete({ where: { id } });
    }
    await logActivity("backup", hasCompleteVerifiedRemoteCopy ? `Local backup files deleted for ${backup.site.name}` : `Backup deleted for ${backup.site.name}`, "warn", {
      siteId: backup.siteId,
      backupId: backup.id,
      remoteCopyRetained: hasCompleteVerifiedRemoteCopy
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 400 }
    );
  }
}
