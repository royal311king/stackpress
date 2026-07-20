import Link from "next/link";
import { CloudUpload } from "lucide-react";

import { PageHeader, SectionCard } from "@/components/cards";
import { SettingsForm } from "@/components/forms";
import { getAppSettings } from "@/lib/services/settings";
import { SettingsNav } from "@/components/settings-nav";
import { CLOUD_BACKUPS_PATH } from "@/lib/navigation";

export default async function SettingsPage() {
  const settings = await getAppSettings();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Global StackPress defaults for timezone, scheduler state, and local storage roots."
      />
      <SettingsNav />
      <aside className="mb-6 flex flex-col gap-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/8 p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="cloud-backups-heading">
        <div className="flex items-start gap-3">
          <CloudUpload className="mt-0.5 shrink-0 text-emerald-300" size={20} aria-hidden="true" />
          <div>
            <h3 id="cloud-backups-heading" className="font-semibold text-slate-100">Cloud Backups</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Connect and manage Google Drive accounts for optional copies of completed local backups.
            </p>
          </div>
        </div>
        <Link className="btn btn-secondary shrink-0" href={CLOUD_BACKUPS_PATH}>
          Manage cloud providers
        </Link>
      </aside>
      <SectionCard title="Application Settings" description="These values seed new sites and control the scheduler heartbeat.">
        <SettingsForm initial={settings as unknown as Record<string, unknown>} />
      </SectionCard>
    </div>
  );
}
