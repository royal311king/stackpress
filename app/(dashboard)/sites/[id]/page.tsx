import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { ActionButton, DeleteBackupButton, RestoreBackupButton, SiteForm } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { RESTORABLE_BACKUP_STATUSES } from "@/lib/services/backup";
import { formatScheduleTime, getNextRunForSite, getScheduleLabel, isScheduleActive, isValidSchedule } from "@/lib/services/scheduler";
import { formatBytes, formatTimestamp } from "@/lib/utils";

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      backups: {
        orderBy: { createdAt: "desc" },
        take: 20
      }
    }
  });

  if (!site) {
    notFound();
  }

  const nextRun = getNextRunForSite(site);
  const lastScheduledBackup = await prisma.backupJob.findFirst({
    where: {
      siteId: site.id,
      triggerSource: "schedule"
    },
    orderBy: { createdAt: "desc" }
  });
  const latestRestorableBackup = await prisma.backupJob.findFirst({
    where: {
      siteId: site.id,
      status: { in: [...RESTORABLE_BACKUP_STATUSES] }
    },
    orderBy: { completedAt: "desc" }
  });
  const scheduleState = isScheduleActive(site) ? (isValidSchedule(site) ? "enabled" : "invalid") : "disabled";
  const scheduleLabel = getScheduleLabel(site);
  const nextRunLabel = formatScheduleTime(nextRun, site.timezone);

  return (
    <div>
      <AutoRefresh />
      <PageHeader
        title={site.name}
        subtitle={`Manage backups and restores for ${site.slug}. This view combines site config, live actions, and historical recovery points.`}
        actions={
          <>
            <ActionButton endpoint={`/api/sites/${site.id}/backup`} label="Backup Now" variant="primary" />
            <RestoreBackupButton
              endpoint={`/api/sites/${site.id}/restore`}
              label="Restore Latest"
              backupType={latestRestorableBackup?.backupType ?? "full"}
              backupTimestamp={latestRestorableBackup ? formatTimestamp(latestRestorableBackup.startedAt ?? latestRestorableBackup.createdAt) : "Latest successful backup"}
              dbDumpPath={latestRestorableBackup?.dbDumpPath}
              filesArchivePath={latestRestorableBackup?.filesArchivePath}
              detailMessage={latestRestorableBackup ? latestRestorableBackup.logExcerpt ?? latestRestorableBackup.errorMessage ?? null : "StackPress will restore the latest successful backup for this site."}
            />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Backup Control" description="Progress and schedule visibility for the selected site.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Current status</p>
              <div className="mt-3">
                <StatusBadge value={site.backups[0]?.status ?? site.lastBackupStatus ?? "idle"} />
              </div>
              <p className="mt-4 text-sm text-slate-400">Last message</p>
              <p className="mt-2 text-sm text-slate-200">{site.lastBackupMessage ?? "No backup has run yet."}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-400">Schedule</p>
                <StatusBadge value={scheduleState} />
              </div>
              <p className="mt-3 text-xl font-semibold">{nextRunLabel}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-400">
                <p>Rule {scheduleLabel}</p>
                <p>Timezone {site.timezone}</p>
                <p>Last scheduled run {lastScheduledBackup ? formatTimestamp(lastScheduledBackup.startedAt ?? lastScheduledBackup.createdAt) : "Never"}</p>
                <div className="flex items-center gap-2">
                  <span>Last scheduled result</span>
                  <StatusBadge value={lastScheduledBackup?.status ?? (scheduleState === "disabled" ? "manual" : "queued")} />
                </div>
                {site.backupFrequency === "cron" && (
                  <p>Cron expression {site.cronExpression ?? "Not configured"}</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-400">Configured Paths</p>
            <div className="mt-3 space-y-2 text-sm">
              <p>Site directory: {site.siteDirectory}</p>
              <p>Uploads path: {site.uploadsPath}</p>
              <p>Backup destination: {site.backupDestination}</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Edit Site" description="Update paths, credentials, backup options, and scheduling from one place.">
          <SiteForm
            site={site as unknown as Record<string, unknown>}
            detectEndpoint={`/api/sites/${site.id}/detect`}
            submitEndpoint={`/api/sites/${site.id}`}
            method="PUT"
          />
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="Backup History" description="Restore or delete a specific recovery point.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Step</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Duration</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {site.backups.map((backup) => {
                  const detailMessage = backup.logExcerpt ?? backup.errorMessage ?? "-";

                  return (
                    <tr key={backup.id}>
                      <td>{formatTimestamp(backup.startedAt ?? backup.createdAt)}</td>
                      <td>
                        <StatusBadge value={backup.status} />
                      </td>
                      <td>{backup.triggerSource}</td>
                      <td>{backup.progressStep ?? "-"}</td>
                      <td>{backup.backupType}</td>
                      <td>{formatBytes(backup.totalBytes)}</td>
                      <td>{backup.durationSeconds ? `${backup.durationSeconds}s` : "-"}</td>
                      <td className="max-w-xs text-sm text-slate-300">{detailMessage}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <Link className="btn btn-secondary" href={`/backups/${backup.id}`}>
                            Details
                          </Link>
                          <RestoreBackupButton
                            endpoint={`/api/sites/${site.id}/restore?backupId=${backup.id}`}
                            backupType={backup.backupType}
                            backupTimestamp={formatTimestamp(backup.startedAt ?? backup.createdAt)}
                            dbDumpPath={backup.dbDumpPath}
                            filesArchivePath={backup.filesArchivePath}
                            detailMessage={detailMessage !== "-" ? detailMessage : null}
                          />
                          <DeleteBackupButton endpoint={`/api/backups/${backup.id}/delete`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
