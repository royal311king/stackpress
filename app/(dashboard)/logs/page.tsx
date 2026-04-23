import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, SectionCard } from "@/components/cards";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/utils";

export default async function LogsPage() {
  const logs = await prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return (
    <div>
      <AutoRefresh intervalMs={4000} />
      <PageHeader
        title="Logs"
        subtitle="Recent application and scheduler events stored in the local SQLite database and the filesystem log."
      />
      <SectionCard title="Recent Events" description="Use this page to diagnose backup failures, scheduler issues, or restore operations.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Level</th>
                <th>Scope</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatTimestamp(log.createdAt)}</td>
                  <td>
                    <StatusBadge value={log.level} />
                  </td>
                  <td>{log.scope}</td>
                  <td>{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
