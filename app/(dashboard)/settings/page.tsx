import { PageHeader, SectionCard } from "@/components/cards";
import { SettingsForm } from "@/components/forms";
import { getAppSettings } from "@/lib/services/settings";

export default async function SettingsPage() {
  const settings = await getAppSettings();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Global StackPress defaults for timezone, scheduler state, and local storage roots."
      />
      <SectionCard title="Application Settings" description="These values seed new sites and control the scheduler heartbeat.">
        <SettingsForm initial={settings as unknown as Record<string, unknown>} />
      </SectionCard>
    </div>
  );
}
