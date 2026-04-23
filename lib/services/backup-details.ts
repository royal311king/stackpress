import fs from "node:fs";

import { prisma } from "@/lib/prisma";
import { RESTORABLE_BACKUP_STATUSES } from "@/lib/services/backup";

function parseMeta(metaJson?: string | null) {
  if (!metaJson) {
    return null;
  }

  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readManifest(manifestPath?: string | null) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getBackupDetail(backupId: string) {
  const backup = await prisma.backupJob.findUnique({
    where: { id: backupId },
    include: { site: true }
  });

  if (!backup) {
    return null;
  }

  const manifest = readManifest(backup.manifestPath);
  const allLogs = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300
  });

  const relevantLogs = allLogs.filter((log) => {
    const meta = parseMeta(log.metaJson);
    const metaBackupId = typeof meta?.backupId === "string" ? meta.backupId : null;
    const metaSiteId = typeof meta?.siteId === "string" ? meta.siteId : null;

    if (metaBackupId === backup.id) {
      return true;
    }

    if (metaSiteId !== backup.siteId) {
      return false;
    }

    const backupStart = (backup.startedAt ?? backup.createdAt).getTime();
    const backupEnd = (backup.completedAt ?? backup.updatedAt).getTime();
    const logTime = log.createdAt.getTime();

    return log.scope === "backup" && logTime >= backupStart - 120000 && logTime <= backupEnd + 120000;
  }).reverse();

  const successfulBackups = await prisma.backupJob.findMany({
    where: {
      siteId: backup.siteId,
      status: { in: [...RESTORABLE_BACKUP_STATUSES] }
    },
    orderBy: { completedAt: "desc" }
  });

  const backupIndex = successfulBackups.findIndex((entry) => entry.id === backup.id);

  return {
    backup,
    manifest,
    relevantLogs,
    retention: {
      newestBackupId: successfulBackups[0]?.id ?? null,
      position: backupIndex >= 0 ? backupIndex + 1 : null,
      totalTrackedBackups: successfulBackups.length,
      retentionCount: backup.site.retentionCount,
      retentionDays: backup.site.retentionDays,
      neverDeleteNewest: backup.site.neverDeleteNewest
    }
  };
}
