import { CloudProviderConnections } from "@/components/cloud-connections";
import { PageHeader, SectionCard } from "@/components/cards";
import { SettingsNav } from "@/components/settings-nav";
import { prisma } from "@/lib/prisma";
import { cloudConnectionService } from "@/lib/services/cloud-storage/connections";

export default async function CloudProvidersPage({
  searchParams
}: {
  searchParams: Promise<{ google?: string; cloud?: string; reason?: string }>;
}) {
  const [connections, usage, query] = await Promise.all([
    cloudConnectionService.list(),
    prisma.siteCloudDestination.groupBy({
      by: ["cloudConnectionId"],
      where: { enabled: true },
      _count: { siteId: true }
    }),
    searchParams
  ]);
  const usageByConnection = new Map(usage.map((item) => [item.cloudConnectionId, item._count.siteId]));
  const callbackStatus = query.google ?? query.cloud;
  const cloudMessage = callbackStatus === "connected" || callbackStatus === "google_connected"
    ? { tone: "success", text: "Google Drive connected successfully." }
    : callbackStatus === "cancelled" || callbackStatus === "google_denied"
      ? { tone: "warning", text: "Google Drive authorization was cancelled. No credentials were changed." }
      : callbackStatus === "error" || callbackStatus === "google_error"
        ? { tone: "error", text: `Google Drive could not be connected${query.reason ? ` (${query.reason.replaceAll("_", " ")})` : ""}.` }
        : null;

  return (
    <div>
      <PageHeader
        title="Cloud Providers"
        subtitle="Connect cloud accounts for optional site backup copies. Local backups remain the primary recovery point."
      />
      <SettingsNav />
      <p className="mb-4 text-sm text-slate-500">Settings / Backups / Cloud Providers</p>
      {cloudMessage ? (
        <p
          className={`mb-5 rounded-xl px-4 py-3 text-sm ${cloudMessage.tone === "success" ? "bg-emerald-400/10 text-emerald-100" : cloudMessage.tone === "warning" ? "bg-amber-400/10 text-amber-100" : "bg-rose-400/10 text-rose-100"}`}
          role={cloudMessage.tone === "error" ? "alert" : "status"}
        >
          {cloudMessage.text}
        </p>
      ) : null}
      <SectionCard title="Connected Accounts" description="Manage provider access and review where each account is used.">
        <CloudProviderConnections
          connections={connections.map((connection) => ({
            ...connection,
            siteCount: usageByConnection.get(connection.id) ?? 0
          }))}
        />
      </SectionCard>
    </div>
  );
}
