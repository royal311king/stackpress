import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { ActionButton, DeleteBackupButton } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { formatBytes, formatTimestamp } from "@/lib/utils";

export default async function BackupsPage() {
  const backups = await prisma.backupJob.findMany({
    include: { site: true },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div>
      <AutoRefresh />
      <PageHeader
        title="Backups"
        subtitle="Cross-site backup history with quick restore and cleanup actions."
      />

      <SectionCard title="All Backup Jobs" description="Use this as the homelab-wide audit trail for backup and restore readiness.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Site</th>
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
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td>{backup.site.name}</td>
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
                        endpoint={`/api/sites/${backup.siteId}/restore?backupId=${backup.id}`}
                        label="Restore"
                        variant="secondary"
                        confirmMessage="Restore this backup and overwrite current site data?"
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
  );
}
