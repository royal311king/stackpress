import { prisma } from "@/lib/prisma";
import { getAppSettings } from "@/lib/services/settings";
import { getDirectoryUsage } from "@/lib/filesystem";

export async function getDashboardData() {
  const [sites, failedBackups, recentBackups, recentLogs, settings] = await Promise.all([
    prisma.site.findMany({
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
    getAppSettings()
  ]);

  const storageUsage = sites.reduce((total, site) => {
    return total + getDirectoryUsage(site.backupDestination);
  }, 0);

  return {
    sites,
    failedBackups,
    recentBackups,
    recentLogs,
    settings,
    storageUsage
  };
}
