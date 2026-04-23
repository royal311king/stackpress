import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard, StatCard } from "@/components/cards";
import { StatusBadge } from "@/components/status-badge";
import { getDashboardData } from "@/lib/services/dashboard";
import { formatBytes, formatRelative, formatTimestamp } from "@/lib/utils";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div>
      <AutoRefresh />
      <PageHeader
        title="Dashboard"
        subtitle="Central backup visibility for all of your Docker-based WordPress sites across the homelab."
        actions={
          <Link className="btn btn-primary" href="/sites">
            Add Site
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Sites" value={String(data.sites.length)} hint="Configured WordPress stacks" />
        <StatCard label="Failed Backups" value={String(data.failedBackups)} hint="All recorded failures" />
        <StatCard label="Storage Usage" value={formatBytes(data.storageUsage)} hint="Across configured destinations" />
        <StatCard
          label="Scheduler"
          value={data.settings.schedulerEnabled ? "Enabled" : "Paused"}
          hint={`Timezone ${data.settings.defaultTimezone}`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <SectionCard title="Sites" description="Status, last backup state, and current backup mode.">
          <div className="space-y-3">
            {data.sites.map((site) => (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.08]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-medium">{site.name}</p>
                    <p className="text-sm text-slate-400">{site.siteDirectory}</p>
                  </div>
                  <StatusBadge value={site.active ? "active" : "inactive"} />
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-slate-400">
                  <span>Last backup: {formatRelative(site.lastBackupAt)}</span>
                  <span>Mode: {site.backupMode}</span>
                  <span>Schedule: {site.scheduleEnabled ? site.backupFrequency : "disabled"}</span>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Recent Activity" description="Latest log events recorded locally.">
          <div className="space-y-3">
            {data.recentLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <StatusBadge value={log.level} />
                  <span className="text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-200">{log.message}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{log.scope}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard title="Recent Backups" description="Most recent backup jobs across all sites.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBackups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{backup.site.name}</td>
                    <td>
                      <StatusBadge value={backup.status} />
                    </td>
                    <td>{backup.backupType}</td>
                    <td>{formatTimestamp(backup.startedAt ?? backup.createdAt)}</td>
                    <td>{backup.durationSeconds ? `${backup.durationSeconds}s` : "-"}</td>
                    <td>{formatBytes(backup.totalBytes)}</td>
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
