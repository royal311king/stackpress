import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runBackup } from "@/lib/services/backup";
import { logActivity } from "@/lib/services/logging";

export type BackupAllSummary = {
  batchId: string;
  totalSites: number;
  succeeded: number;
  warnings: number;
  failed: number;
};

export async function runBackupAllActiveSites(): Promise<BackupAllSummary> {
  const sites = await prisma.site.findMany({
    where: { active: true },
    orderBy: { name: "asc" }
  });

  const summary: BackupAllSummary = {
    batchId: randomUUID(),
    totalSites: sites.length,
    succeeded: 0,
    warnings: 0,
    failed: 0
  };

  if (sites.length === 0) {
    await logActivity("backup_all", "Bulk backup skipped: no active sites", "warn", {
      ...summary,
      state: "completed"
    });
    return summary;
  }

  await logActivity("backup_all", `Bulk backup started for ${sites.length} active sites`, "info", {
    ...summary,
    state: "running"
  });

  for (const [index, site] of sites.entries()) {
    await logActivity("backup_all", `Running backup ${index + 1}/${sites.length} for ${site.name}`, "info", {
      ...summary,
      state: "running",
      currentSiteId: site.id,
      currentSiteName: site.name,
      completedSites: index
    });

    try {
      const result = await runBackup(site.id, "bulk");
      if (result.status === "success_with_warnings") {
        summary.warnings += 1;
      } else {
        summary.succeeded += 1;
      }

      await logActivity(
        "backup_all",
        result.status === "success_with_warnings"
          ? `Backup completed with warnings for ${site.name}`
          : `Backup completed for ${site.name}`,
        result.status === "success_with_warnings" ? "warn" : "info",
        {
          ...summary,
          state: "running",
          currentSiteId: site.id,
          currentSiteName: site.name,
          backupId: result.backupId,
          warningMessage: result.warningMessage
        }
      );
    } catch (error) {
      summary.failed += 1;
      await logActivity("backup_all", `Backup failed for ${site.name}`, "error", {
        ...summary,
        state: "running",
        currentSiteId: site.id,
        currentSiteName: site.name,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  await logActivity(
    "backup_all",
    `Bulk backup finished: ${summary.succeeded} succeeded, ${summary.warnings} with warnings, ${summary.failed} failed`,
    summary.failed > 0 ? "warn" : "info",
    {
      ...summary,
      state: "completed"
    }
  );

  return summary;
}
