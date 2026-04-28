import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/cards";
import { SiteForm } from "@/components/forms";
import { SiteAutoDetectButton } from "@/components/site-auto-detect";
import { StatusBadge } from "@/components/status-badge";
import { getWpAdminUrl, normalizeSiteUrl } from "@/lib/site-url";
import { formatRelative, formatTimestamp } from "@/lib/utils";
import { formatScheduleTime, getNextRunForSite, getScheduleLabel, isScheduleActive, isValidSchedule } from "@/lib/services/scheduler";

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    include: {
      backups: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const scheduleData = await Promise.all(
    sites.map(async (site) => {
      const nextRun = getNextRunForSite(site);
      const lastScheduledBackup = await prisma.backupJob.findFirst({
        where: { siteId: site.id, triggerSource: "schedule" },
        orderBy: { createdAt: "desc" }
      });

      return {
        ...site,
        siteHref: normalizeSiteUrl(site.siteUrl),
        wpAdminHref: getWpAdminUrl(site.siteUrl),
        nextRun,
        nextRunLabel: formatScheduleTime(nextRun, site.timezone),
        scheduleLabel: getScheduleLabel(site),
        scheduleState: isScheduleActive(site) ? (isValidSchedule(site) ? "enabled" : "invalid") : "disabled",
        lastScheduledBackup
      };
    })
  );

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Register Docker-based WordPress sites, detect container settings, and configure site-specific retention and schedules."
        actions={<SiteAutoDetectButton />}
      />

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Configured Sites" description="Each site stores paths, Docker names, credentials, notes, and schedule state.">
          <div className="space-y-3">
            {scheduleData.map((site) => (
              <div
                key={site.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/sites/${site.id}`} className="block">
                      <p className="text-lg font-medium">{site.name}</p>
                      <p className="mt-1 break-all text-sm text-slate-400">{site.siteDirectory}</p>
                      <p className="mt-2 break-all text-sm text-slate-500">
                        Last backup {formatRelative(site.lastBackupAt)} • Destination {site.backupDestination}
                      </p>
                    </Link>
                    <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-400">
                      <span>Schedule: {site.scheduleLabel}</span>
                      <span>Next run: {site.nextRunLabel}</span>
                      <span>
                        Last scheduled run: {site.lastScheduledBackup ? formatTimestamp(site.lastScheduledBackup.startedAt ?? site.lastScheduledBackup.createdAt) : "Never"}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link className="btn btn-secondary" href={`/sites/${site.id}`}>
                        Manage
                      </Link>
                      {site.siteHref ? (
                        <a className="btn btn-secondary" href={site.siteHref} target="_blank" rel="noreferrer">
                          Open Site
                        </a>
                      ) : null}
                      {site.wpAdminHref ? (
                        <a className="btn btn-secondary" href={site.wpAdminHref} target="_blank" rel="noreferrer">
                          Open WP Admin
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge value={site.active ? "active" : "inactive"} />
                    <StatusBadge value={site.healthStatus} />
                    <StatusBadge value={site.scheduleState} />
                    <StatusBadge value={site.lastScheduledBackup?.status ?? (site.scheduleState === "disabled" ? "manual" : "queued")} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Add Site" description="Use auto-detection when your site follows the typical homelab folder and container naming pattern.">
          <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="text-sm font-medium text-emerald-100">Auto-detect Docker WordPress sites</p>
            <p className="mt-2 text-sm text-emerald-50/80">Scan /mnt/wp-sites, review detected docker-compose.yml stacks, then import selected sites into StackPress.</p>
            <div className="mt-4">
              <SiteAutoDetectButton fullWidth />
            </div>
          </div>
          <SiteForm detectEndpoint="/api/sites/detect" submitEndpoint="/api/sites" method="POST" />
        </SectionCard>
      </div>
    </div>
  );
}
