import fs from "node:fs";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { DeleteBackupButton, RestoreBackupButton } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { getBackupDetail } from "@/lib/services/backup-details";
import { formatBytes, formatTimestamp } from "@/lib/utils";

function basename(value?: string | null) {
  if (!value) {
    return "Missing";
  }

  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? value;
}

export default async function BackupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBackupDetail(id);

  if (!detail) {
    notFound();
  }

  const { backup, manifest, relevantLogs, retention } = detail;
  const warnings = [
    ...(Array.isArray(manifest?.warnings) ? manifest.warnings : []),
    ...(backup.logExcerpt ? [backup.logExcerpt] : [])
  ].filter((value, index, values) => typeof value === "string" && value.trim() && values.indexOf(value) === index) as string[];

  const manifestJson = backup.manifestPath && fs.existsSync(backup.manifestPath)
    ? fs.readFileSync(backup.manifestPath, "utf8")
    : null;

  return (
    <div>
      <AutoRefresh intervalMs={4000} />
      <PageHeader
        title="Backup Details"
        subtitle={`Detailed backup record for ${backup.site.name} at ${formatTimestamp(backup.startedAt ?? backup.createdAt)}.`}
        actions={
          <>
            <Link className="btn btn-secondary" href="/backups">
              Back to Backups
            </Link>
            <RestoreBackupButton
              endpoint={`/api/sites/${backup.siteId}/restore?backupId=${backup.id}`}
              backupType={backup.backupType}
              backupTimestamp={formatTimestamp(backup.startedAt ?? backup.createdAt)}
              dbDumpPath={backup.dbDumpPath}
              filesArchivePath={backup.filesArchivePath}
              detailMessage={backup.logExcerpt ?? backup.errorMessage ?? null}
            />
            <DeleteBackupButton endpoint={`/api/backups/${backup.id}/delete`} />
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <SectionCard title="Backup Summary" description="Core job status, artifacts, and runtime details.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Site</p>
              <p className="mt-2 text-lg font-medium">{backup.site.name}</p>
              <p className="mt-4 text-sm text-slate-400">Timestamp</p>
              <p className="mt-2 text-sm text-slate-200">{formatTimestamp(backup.startedAt ?? backup.createdAt)}</p>
              <p className="mt-4 text-sm text-slate-400">Status</p>
              <div className="mt-2"><StatusBadge value={backup.status} /></div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Source</p>
              <p className="mt-2 text-sm text-slate-200 capitalize">{backup.triggerSource}</p>
              <p className="mt-4 text-sm text-slate-400">Backup type</p>
              <p className="mt-2 text-sm text-slate-200 capitalize">{backup.backupType}</p>
              <p className="mt-4 text-sm text-slate-400">Duration</p>
              <p className="mt-2 text-sm text-slate-200">{backup.durationSeconds ? `${backup.durationSeconds}s` : "-"}</p>
              <p className="mt-4 text-sm text-slate-400">Total size</p>
              <p className="mt-2 text-sm text-slate-200">{formatBytes(backup.totalBytes)}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Database dump</p>
              <p className="mt-2 text-sm text-slate-100">{basename(backup.dbDumpPath)}</p>
              <p className="mt-2 text-xs text-slate-500">{backup.dbDumpPath ?? "No database dump recorded"}</p>
              {typeof manifest?.dbBytes === "number" ? <p className="mt-3 text-sm text-slate-300">Size {formatBytes(manifest.dbBytes)}</p> : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-slate-400">Files archive</p>
              <p className="mt-2 text-sm text-slate-100">{basename(backup.filesArchivePath)}</p>
              <p className="mt-2 text-xs text-slate-500">{backup.filesArchivePath ?? "No file archive recorded"}</p>
              {typeof manifest?.filesBytes === "number" ? <p className="mt-3 text-sm text-slate-300">Size {formatBytes(manifest.filesBytes)}</p> : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-slate-400">Retention info</p>
            <div className="mt-3 space-y-2 text-sm text-slate-200">
              <p>Keep last {retention.retentionCount} successful backups.</p>
              <p>{retention.retentionDays ? `Delete backups older than ${retention.retentionDays} days.` : "Age-based deletion is disabled."}</p>
              <p>{retention.neverDeleteNewest ? "Newest successful backup is protected from retention cleanup." : "Newest backup protection is disabled."}</p>
              <p>{retention.position ? `This backup is position ${retention.position} of ${retention.totalTrackedBackups} successful backups for this site.` : "This backup is not part of the current successful-backup retention set."}</p>
              {retention.newestBackupId === backup.id ? <p>This is currently the newest successful backup for this site.</p> : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Warnings" description="Warnings, errors, and notable manifest details for this backup.">
          {warnings.length > 0 ? (
            <div className="space-y-3">
              {warnings.map((warning) => (
                <div key={warning} className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No warnings were recorded for this backup.</p>
          )}

          {backup.errorMessage ? (
            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
              {backup.errorMessage}
            </div>
          ) : null}

          {manifest ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p className="text-sm text-slate-400">Manifest summary</p>
              <div className="mt-3 space-y-2">
                <p>Recorded at {String(manifest.timestamp ?? "Unknown")}</p>
                <p>Backup type {String(manifest.backupType ?? backup.backupType)}</p>
                {Array.isArray(manifest.fileExclusions) ? <p>File exclusions {manifest.fileExclusions.length}</p> : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
              No manifest data was available for this backup.
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Log Output" description="Related activity log entries for this backup run.">
          {relevantLogs.length > 0 ? (
            <div className="space-y-3">
              {relevantLogs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge value={log.level} />
                    <span className="text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-100">{log.message}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{log.scope}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No related log entries were found for this backup.</p>
          )}
        </SectionCard>

        <SectionCard title="Manifest JSON" description="Raw manifest content stored with this backup.">
          {manifestJson ? (
            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs text-slate-200">
              {manifestJson}
            </pre>
          ) : (
            <p className="text-sm text-slate-400">Manifest file not found on disk.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
