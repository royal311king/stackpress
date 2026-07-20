"use client";

import { PageHeader, SectionCard } from "@/components/cards";
import { SettingsNav } from "@/components/settings-nav";

export default function CloudProvidersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <PageHeader title="Cloud Providers" subtitle="Manage optional cloud backup destinations." />
      <SettingsNav />
      <SectionCard title="Cloud providers unavailable" description="StackPress could not load the provider records.">
        <p className="text-sm text-rose-200" role="alert">Check the database connection and try loading this page again.</p>
        <button className="btn btn-secondary mt-4" type="button" onClick={reset}>Try again</button>
      </SectionCard>
    </div>
  );
}
