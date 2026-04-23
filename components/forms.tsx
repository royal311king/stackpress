"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type SiteFormProps = {
  site?: Record<string, unknown>;
  detectEndpoint: string;
  submitEndpoint: string;
  method: "POST" | "PUT";
};

function checkboxValue(formData: FormData, field: string) {
  return formData.get(field) === "on";
}

export function SiteForm({ site, detectEndpoint, submitEndpoint, method }: SiteFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    name: String(site?.name ?? ""),
    slug: String(site?.slug ?? ""),
    siteDirectory: String(site?.siteDirectory ?? ""),
    backupDestination: String(site?.backupDestination ?? ""),
    dbContainerName: String(site?.dbContainerName ?? ""),
    dbName: String(site?.dbName ?? "wpdb"),
    dbUser: String(site?.dbUser ?? "wpuser"),
    dbPassword: String(site?.dbPassword ?? "wppass123"),
    wordpressContainerName: String(site?.wordpressContainerName ?? ""),
    uploadsPath: String(site?.uploadsPath ?? ""),
    notes: String(site?.notes ?? ""),
    backupFrequency: String(site?.backupFrequency ?? "manual"),
    backupTime: String(site?.backupTime ?? "02:00"),
    timezone: String(site?.timezone ?? "America/Chicago"),
    cronExpression: String(site?.cronExpression ?? ""),
    retentionCount: String(site?.retentionCount ?? "10"),
    retentionDays: String(site?.retentionDays ?? ""),
    backupMode: String(site?.backupMode ?? "full")
  });
  const [active, setActive] = useState(Boolean(site?.active ?? true));
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(site?.scheduleEnabled ?? false));
  const [neverDeleteNewest, setNeverDeleteNewest] = useState(Boolean(site?.neverDeleteNewest ?? true));

  async function onDetect() {
    setDetecting(true);
    setMessage(null);
    const response = await fetch(detectEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteDirectory: values.siteDirectory })
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Detection failed");
      setDetecting(false);
      return;
    }

    setValues((current) => ({
      ...current,
      name: data.siteName ?? current.name,
      slug: data.slug ?? current.slug,
      dbContainerName: data.dbContainerName ?? current.dbContainerName,
      dbName: data.dbName ?? current.dbName,
      dbUser: data.dbUser ?? current.dbUser,
      dbPassword: data.dbPassword ?? current.dbPassword,
      wordpressContainerName: data.wordpressContainerName ?? current.wordpressContainerName,
      uploadsPath: data.uploadsPath ?? current.uploadsPath
    }));
    setMessage("Docker compose settings detected and applied.");
    setDetecting(false);
  }

  function updateField(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get("name"),
      slug: formData.get("slug"),
      siteDirectory: formData.get("siteDirectory"),
      backupDestination: formData.get("backupDestination"),
      dbContainerName: formData.get("dbContainerName"),
      dbName: formData.get("dbName"),
      dbUser: formData.get("dbUser"),
      dbPassword: formData.get("dbPassword"),
      wordpressContainerName: formData.get("wordpressContainerName"),
      uploadsPath: formData.get("uploadsPath"),
      notes: formData.get("notes"),
      backupFrequency: formData.get("backupFrequency"),
      backupTime: formData.get("backupTime"),
      timezone: formData.get("timezone"),
      cronExpression: formData.get("cronExpression"),
      retentionCount: Number(formData.get("retentionCount")),
      retentionDays: formData.get("retentionDays")
        ? Number(formData.get("retentionDays"))
        : null,
      backupMode: formData.get("backupMode"),
      active: checkboxValue(formData, "active"),
      scheduleEnabled: checkboxValue(formData, "scheduleEnabled"),
      neverDeleteNewest: checkboxValue(formData, "neverDeleteNewest")
    };

    startTransition(async () => {
      const response = await fetch(submitEndpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Save failed");
        return;
      }
      router.refresh();
      router.push(data.redirectTo ?? "/sites");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Site Name</span>
          <input className="input" name="name" value={values.name} onChange={(e) => updateField("name", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Site Slug</span>
          <input className="input" name="slug" value={values.slug} onChange={(e) => updateField("slug", e.target.value)} />
        </label>
        <label className="block md:col-span-2 xl:col-span-1">
          <span className="mb-2 block text-sm text-slate-300">Site Directory</span>
          <input className="input" name="siteDirectory" value={values.siteDirectory} onChange={(e) => updateField("siteDirectory", e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm text-slate-300">Backup Destination</span>
          <input className="input" name="backupDestination" value={values.backupDestination} onChange={(e) => updateField("backupDestination", e.target.value)} />
        </label>
        <div className="flex items-end">
          <button type="button" onClick={onDetect} className="btn btn-secondary w-full" disabled={detecting}>
            {detecting ? "Detecting..." : "Auto-Detect docker-compose"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">DB Container</span>
          <input className="input" name="dbContainerName" value={values.dbContainerName} onChange={(e) => updateField("dbContainerName", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">DB Name</span>
          <input className="input" name="dbName" value={values.dbName} onChange={(e) => updateField("dbName", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">DB User</span>
          <input className="input" name="dbUser" value={values.dbUser} onChange={(e) => updateField("dbUser", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">DB Password</span>
          <input className="input" name="dbPassword" value={values.dbPassword} onChange={(e) => updateField("dbPassword", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">WordPress Container</span>
          <input className="input" name="wordpressContainerName" value={values.wordpressContainerName} onChange={(e) => updateField("wordpressContainerName", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Uploads Path</span>
          <input className="input" name="uploadsPath" value={values.uploadsPath} onChange={(e) => updateField("uploadsPath", e.target.value)} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Backup Frequency</span>
          <select className="select" name="backupFrequency" value={values.backupFrequency} onChange={(e) => updateField("backupFrequency", e.target.value)}>
            <option value="manual">Manual</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="cron">Cron Expression</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Backup Time</span>
          <input className="input" type="time" name="backupTime" value={values.backupTime} onChange={(e) => updateField("backupTime", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Timezone</span>
          <input className="input" name="timezone" value={values.timezone} onChange={(e) => updateField("timezone", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Cron Expression</span>
          <input className="input" name="cronExpression" value={values.cronExpression} onChange={(e) => updateField("cronExpression", e.target.value)} placeholder="0 2 * * *" />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Retention Count</span>
          <input className="input" type="number" min="1" max="100" name="retentionCount" value={values.retentionCount} onChange={(e) => updateField("retentionCount", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Delete Older Than Days</span>
          <input className="input" type="number" min="1" name="retentionDays" value={values.retentionDays} onChange={(e) => updateField("retentionDays", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm text-slate-300">Backup Mode</span>
          <select className="select" name="backupMode" value={values.backupMode} onChange={(e) => updateField("backupMode", e.target.value)}>
            <option value="full">Full Backup</option>
            <option value="database">Database Only</option>
            <option value="files">Files Only</option>
          </select>
        </label>
        <label className="block md:col-span-2 xl:col-span-1">
          <span className="mb-2 block text-sm text-slate-300">Notes</span>
          <textarea className="textarea min-h-28" name="notes" value={values.notes} onChange={(e) => updateField("notes", e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 md:grid-cols-3">
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Site active
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" name="scheduleEnabled" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
          Enable schedule
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" name="neverDeleteNewest" checked={neverDeleteNewest} onChange={(e) => setNeverDeleteNewest(e.target.checked)} />
          Never delete newest
        </label>
      </div>

      {message ? <p className="text-sm text-emerald-200">{message}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving..." : "Save Site"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => router.push("/sites")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type ActionButtonProps = {
  endpoint: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirmMessage?: string;
};

export function ActionButton({ endpoint, label, variant = "secondary", confirmMessage }: ActionButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className={`btn ${variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-secondary"}`}
      disabled={pending}
      onClick={() => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          return;
        }
        startTransition(async () => {
          const response = await fetch(endpoint, { method: "POST" });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            window.alert(data.error ?? "Action failed");
            return;
          }
          router.refresh();
        });
      }}
      type="button"
    >
      {pending ? "Working..." : label}
    </button>
  );
}

export function DeleteBackupButton({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="btn btn-danger"
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this backup record and any backup files on disk?")) {
          return;
        }
        startTransition(async () => {
          const response = await fetch(endpoint, { method: "POST" });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            window.alert(data.error ?? "Delete failed");
            return;
          }
          router.refresh();
        });
      }}
    >
      {pending ? "Deleting..." : "Delete"}
    </button>
  );
}

export function SettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              defaultTimezone: formData.get("defaultTimezone"),
              defaultBackupRoot: formData.get("defaultBackupRoot"),
              defaultLogRoot: formData.get("defaultLogRoot"),
              schedulerEnabled: formData.get("schedulerEnabled") === "on",
              diskFreeThresholdGb: Number(formData.get("diskFreeThresholdGb"))
            })
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            window.alert(data.error ?? "Save failed");
            return;
          }
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="mb-2 block text-sm text-slate-300">Default Timezone</span>
        <input className="input" defaultValue={String(initial.defaultTimezone ?? "")} name="defaultTimezone" />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm text-slate-300">Default Backup Root</span>
        <input className="input" defaultValue={String(initial.defaultBackupRoot ?? "")} name="defaultBackupRoot" />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm text-slate-300">Default Log Root</span>
        <input className="input" defaultValue={String(initial.defaultLogRoot ?? "")} name="defaultLogRoot" />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm text-slate-300">Disk Free Threshold (GB)</span>
        <input className="input" type="number" min="1" defaultValue={String(initial.diskFreeThresholdGb ?? 2)} name="diskFreeThresholdGb" />
      </label>
      <label className="flex items-center gap-3 text-sm text-slate-300">
        <input type="checkbox" name="schedulerEnabled" defaultChecked={Boolean(initial.schedulerEnabled ?? true)} />
        Scheduler enabled
      </label>
      <button className="btn btn-primary" disabled={pending} type="submit">
        {pending ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
