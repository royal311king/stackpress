import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { DeleteBackupButton, RestoreBackupButton } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { formatBytes, formatTimestamp } from "@/lib/utils";
import { requiredBackupArtifactKinds } from "@/lib/services/cloud-storage/types";

export default async function BackupsPage() {
  const [backups, cloudUploads, cloudFiles] = await Promise.all([
    prisma.backupJob.findMany({
      include: { site: { include: { cloudDestinations: { include: { cloudConnection: true } } } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.cloudUploadJob.findMany(),
    prisma.cloudBackupFile.findMany()
  ]);

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
                <th>Created</th>
                <th>Local status</th>
                <th>Source</th>
                <th>Step</th>
                <th>Type</th>
                <th>Local size</th>
                <th>Cloud copies</th>
                <th>Duration</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => {
                const detailMessage = backup.logExcerpt ?? backup.errorMessage ?? "-";
                const uploads = cloudUploads.filter((upload) => upload.backupId === backup.id);
                const files = cloudFiles.filter((file) => file.backupId === backup.id);
                const destinationIds = [...new Set([
                  ...backup.site.cloudDestinations.map((destination) => destination.cloudConnectionId),
                  ...uploads.map((upload) => upload.cloudConnectionId)
                ])];
                const hasVerifiedRemoteCopy = destinationIds.some((connectionId) => {
                  const remoteFiles = files.filter((file) => file.cloudConnectionId === connectionId && file.uploadStatus === "success");
                  const verifiedKinds = new Set(remoteFiles.filter((file) => file.verifiedAt && file.verificationStatus === "verified").map((file) => file.artifactKind));
                  return requiredBackupArtifactKinds(backup.backupType).every((kind) => verifiedKinds.has(kind));
                });

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
                    <td>
                      {destinationIds.length ? <div className="space-y-2">{destinationIds.map((connectionId) => {
                        const destination = backup.site.cloudDestinations.find((item) => item.cloudConnectionId === connectionId);
                        const upload = uploads.find((item) => item.cloudConnectionId === connectionId);
                        return <div key={connectionId} className="min-w-44"><p className="text-xs text-slate-400">{destination?.cloudConnection.displayName ?? "Google Drive"}</p><div className="mt-1"><StatusBadge value={upload?.status ?? "not_uploaded"} /></div></div>;
                      })}</div> : <span className="text-sm text-slate-500">Local only</span>}
                    </td>
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
                        <DeleteBackupButton endpoint={`/api/backups/${backup.id}/delete`} hasVerifiedRemoteCopy={hasVerifiedRemoteCopy} />
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
