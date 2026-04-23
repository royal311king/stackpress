import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { ActionButton, DeleteBackupButton, SiteForm } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { getNextRunForSite } from "@/lib/services/scheduler";
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

  return (
    <div>
      <AutoRefresh />
      <PageHeader
        title={site.name}
        subtitle={`Manage backups and restores for ${site.slug}. This view combines site config, live actions, and historical recovery points.`}
        actions={
          <>
            <ActionButton endpoint={`/api/sites/${site.id}/backup`} label="Backup Now" variant="primary" />
            <ActionButton
              endpoint={`/api/sites/${site.id}/restore`}
              label="Restore Latest"
              variant="danger"
              confirmMessage="Restore the latest backup? This stops containers and overwrites site data."
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
              <p className="text-sm text-slate-400">Next run</p>
              <p className="mt-3 text-xl font-semibold">{nextRun ? formatTimestamp(nextRun) : "Not scheduled"}</p>
              <p className="mt-3 text-sm text-slate-400">
                Frequency {site.scheduleEnabled ? site.backupFrequency : "disabled"} • Timezone {site.timezone}
              </p>
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
                  <th>Step</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Duration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {site.backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{formatTimestamp(backup.startedAt ?? backup.createdAt)}</td>
                    <td>
                      <StatusBadge value={backup.status} />
                    </td>
                    <td>{backup.progressStep ?? "-"}</td>
                    <td>{backup.backupType}</td>
                    <td>{formatBytes(backup.totalBytes)}</td>
                    <td>{backup.durationSeconds ? `${backup.durationSeconds}s` : "-"}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          endpoint={`/api/sites/${site.id}/restore?backupId=${backup.id}`}
                          label="Restore"
                          variant="secondary"
                          confirmMessage="Restore this backup? This stops containers and overwrites site data."
                        />
                        <DeleteBackupButton endpoint={`/api/backups/${backup.id}/delete`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
