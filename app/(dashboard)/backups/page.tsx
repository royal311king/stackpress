import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { DeleteBackupButton, RestoreBackupButton } from "@/components/forms";
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
              {backups.map((backup) => {
                const detailMessage = backup.logExcerpt ?? backup.errorMessage ?? "-";

                return (
                  <tr key={backup.id}>
                    <td>{backup.site.name}</td>
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
                          endpoint={`/api/sites/${backup.siteId}/restore?backupId=${backup.id}`}
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
  );
}
