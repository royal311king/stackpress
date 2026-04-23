import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/cards";
import { SiteForm } from "@/components/forms";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    orderBy: { updatedAt: "desc" }
  });

  return (
    <div>
      <PageHeader
        title="Sites"
        subtitle="Register Docker-based WordPress sites, detect container settings, and configure site-specific retention and schedules."
      />

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Configured Sites" description="Each site stores paths, Docker names, credentials, notes, and schedule state.">
          <div className="space-y-3">
            {sites.map((site) => (
              <a
                key={site.id}
                href={`/sites/${site.id}`}
                className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-medium">{site.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{site.siteDirectory}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      Last backup {formatRelative(site.lastBackupAt)} • Destination {site.backupDestination}
                    </p>
                  </div>
                  <StatusBadge value={site.active ? "active" : "inactive"} />
                </div>
              </a>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Add Site" description="Use auto-detection when your site follows the typical homelab folder and container naming pattern.">
          <SiteForm detectEndpoint="/api/sites/detect" submitEndpoint="/api/sites" method="POST" />
        </SectionCard>
      </div>
    </div>
  );
}
