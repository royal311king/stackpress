import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/services/settings";
import { getDirectoryUsage } from "@/lib/filesystem";
import { formatScheduleTime, getNextRunForSite, getScheduleLabel, isScheduleActive, isValidSchedule } from "@/lib/services/scheduler";

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

export async function getDashboardData() {
  const [sites, failedBackups, recentBackups, recentLogs, bulkLogs, settings] = await Promise.all([
    prisma.site.findMany({
      include: {
        backups: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.backupJob.count({
      where: {
        status: "failed"
      }
    }),
    prisma.backupJob.findMany({
      include: { site: true },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.activityLog.findMany({
      where: { scope: "backup_all" },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    getAppSettings()
  ]);

  const storageUsage = sites.reduce((total, site) => {
    return total + getDirectoryUsage(site.backupDestination);
  }, 0);

  const enrichedSites = await Promise.all(
    sites.map(async (site) => {
      const lastScheduledBackup = await prisma.backupJob.findFirst({
        where: {
          siteId: site.id,
          triggerSource: "schedule"
        },
        orderBy: { createdAt: "desc" }
      });

      const nextRun = getNextRunForSite(site);
      return {
        ...site,
        scheduleState: isScheduleActive(site) ? (isValidSchedule(site) ? "enabled" : "invalid") : "disabled",
        scheduleLabel: getScheduleLabel(site),
        nextRun,
        nextRunLabel: formatScheduleTime(nextRun, site.timezone),
        lastScheduledBackup
      };
    })
  );

  const latestBulkLog = bulkLogs[0] ?? null;
  const latestBulkMeta = parseMeta(latestBulkLog?.metaJson ?? null);

  return {
    sites: enrichedSites,
    failedBackups,
    recentBackups,
    recentLogs,
    settings,
    storageUsage,
    latestBulkBackup: latestBulkLog
      ? {
          message: latestBulkLog.message,
          level: latestBulkLog.level,
          createdAt: latestBulkLog.createdAt,
          state: String(latestBulkMeta?.state ?? "unknown"),
          totalSites: Number(latestBulkMeta?.totalSites ?? 0),
          succeeded: Number(latestBulkMeta?.succeeded ?? 0),
          warnings: Number(latestBulkMeta?.warnings ?? 0),
          failed: Number(latestBulkMeta?.failed ?? 0),
          currentSiteName: latestBulkMeta?.currentSiteName ? String(latestBulkMeta.currentSiteName) : null
        }
      : null
  };
}
