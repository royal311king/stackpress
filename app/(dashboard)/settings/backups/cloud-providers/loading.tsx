import { PageHeader, SectionCard } from "@/components/cards";
import { SettingsNav } from "@/components/settings-nav";

export default function CloudProvidersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading cloud providers">
      <PageHeader title="Cloud Providers" subtitle="Loading connected accounts and site usage…" />
      <SettingsNav />
      <SectionCard title="Connected Accounts" description="Loading provider status.">
        <div className="space-y-4">
          {[0, 1].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-white/5 motion-reduce:animate-none" />)}
        </div>
      </SectionCard>
    </div>
  );
}
