"use client";

import { useRouter } from "next/navigation";
import { FileSearch, FolderOpen } from "lucide-react";

import { SectionCard } from "@/components/cards";
import { useEffect, useMemo, useState, useTransition } from "react";

type SiteFormProps = {
  site?: Record<string, unknown>;
  detectEndpoint: string;
  submitEndpoint: string;
  method: "POST" | "PUT";
};

type PathPickerTarget = {
  field: "siteDirectory" | "backupDestination" | "uploadsPath" | "composePath";
  mode: "directory" | "file";
  title: string;
  initialPath: string;
} | null;

type PathEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "other";
};

type PathCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  canCreate?: boolean;
};

type MountInfo = {
  hostPath: string;
  containerPath: string;
  filesystem: string;
};

type DetectedVolumeMount = {
  service: string;
  source: string;
  target: string;
  type: string;
};

type DetectionFallbackGuess = {
  field: string;
  value: string;
  reason: string;
};

function checkboxValue(formData: FormData, field: string) {
  return formData.get(field) === "on";
}

function basename(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? value;
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = {
    wordpressContainerName: "WordPress Container",
    dbContainerName: "DB Container",
    dbName: "DB Name",
    dbUser: "DB User",
    dbPassword: "DB Password"
  };
  return labels[field] ?? field;
}

function getRestoreValidation(backupType: string, dbDumpPath?: string | null, filesArchivePath?: string | null) {
  if (backupType === "full") {
    if (!dbDumpPath && !filesArchivePath) {
      return "This full backup is missing both the database dump and the file archive.";
    }
    if (!dbDumpPath) {
      return "This full backup is missing the database dump.";
    }
    if (!filesArchivePath) {
      return "This full backup is missing the file archive.";
    }
    return null;
  }

  if (backupType === "database" && !dbDumpPath) {
    return "This database-only backup is missing the SQL dump.";
  }

  if (backupType === "files" && !filesArchivePath) {
    return "This files-only backup is missing the archive.";
  }

  return null;
}

function PathPickerDialog({ picker, onSelect, onClose }: { picker: NonNullable<PathPickerTarget>; onSelect: (path: string) => void; onClose: () => void }) {
  const [currentPath, setCurrentPath] = useState(picker.initialPath || "/");
  const [parentPath, setParentPath] = useState("/");
  const [entries, setEntries] = useState<PathEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    if (!picker) {
      return;
    }

    async function loadPath() {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/filesystem/list?path=${encodeURIComponent(currentPath)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Unable to browse this path");
        setEntries([]);
        setLoading(false);
        return;
      }

      setCurrentPath(data.currentPath ?? currentPath);
      setParentPath(data.parentPath ?? "/");
      setEntries(data.entries ?? []);
      setLoading(false);
    }

    loadPath();
  }, [currentPath, picker]);

  const selectableFiles = picker.mode === "file"
    ? entries.filter((entry) => entry.type === "file" && (entry.name === "docker-compose.yml" || entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
      <div className="panel flex max-h-[82vh] w-full max-w-3xl flex-col rounded-3xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">Container-visible browser</p>
            <h3 className="mt-2 text-2xl font-semibold">{picker.title}</h3>
            <p className="mt-2 break-all text-sm text-slate-400">Browsing: {currentPath}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-50">
          This picker shows paths visible to the StackPress app/container. Use these paths in StackPress fields.
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="btn btn-secondary" onClick={() => setCurrentPath(parentPath)}>Up</button>
          {picker.mode === "directory" ? (
            <button type="button" className="btn btn-primary" onClick={() => onSelect(currentPath)}>Use This Folder</button>
          ) : null}
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03]">
          {loading ? <p className="p-4 text-sm text-slate-400">Loading...</p> : null}
          {!loading && entries.length === 0 ? <p className="p-4 text-sm text-slate-400">No visible entries in this folder.</p> : null}
          <div className="divide-y divide-white/10">
            {entries.filter((entry) => entry.type === "directory").map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-white/5"
                onClick={() => setCurrentPath(entry.path)}
              >
                <span className="break-all font-mono text-slate-100">{entry.name}/</span>
                <span className="text-xs text-slate-500">Open</span>
              </button>
            ))}
            {picker.mode === "file" ? selectableFiles.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-white/5"
                onClick={() => onSelect(entry.path)}
              >
                <span className="break-all font-mono text-slate-100">{entry.name}</span>
                <span className="text-xs text-cyan-200">Select</span>
              </button>
            )) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function PickerButton({ label, kind = "folder", onClick }: { label: string; kind?: "folder" | "file"; onClick: () => void }) {
  const Icon = kind === "file" ? FileSearch : FolderOpen;

  return (
    <button type="button" className="btn btn-secondary inline-flex items-center justify-center gap-2" onClick={onClick}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function CheckBadge({ check }: { check: PathCheck }) {
  const className = check.status === "pass"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
    : check.status === "warn"
      ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
      : "border-rose-400/25 bg-rose-400/10 text-rose-100";

  return (
    <div className={`rounded-2xl border p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">{check.label}</p>
        <span className="rounded-full border border-current/30 px-2.5 py-1 text-xs uppercase tracking-[0.16em]">{check.status}</span>
      </div>
      <p className="mt-2 break-words text-sm opacity-90">{check.message}</p>
    </div>
  );
}

export function SiteForm({ site, detectEndpoint, submitEndpoint, method }: SiteFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warn" | "error">("success");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [picker, setPicker] = useState<PathPickerTarget>(null);
  const [pathChecks, setPathChecks] = useState<PathCheck[]>([]);
  const [mounts, setMounts] = useState<MountInfo[]>([]);
  const [detectedVolumeMounts, setDetectedVolumeMounts] = useState<DetectedVolumeMount[]>([]);
  const [fallbackGuesses, setFallbackGuesses] = useState<DetectionFallbackGuess[]>([]);
  const [fallbackConfirmed, setFallbackConfirmed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    name: String(site?.name ?? ""),
    slug: String(site?.slug ?? ""),
    siteUrl: String(site?.siteUrl ?? ""),
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

  useEffect(() => {
    async function loadMounts() {
      const response = await fetch("/api/system/mounts");
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setMounts(data.mounts ?? []);
      }
    }

    loadMounts();
  }, []);

  function updateField(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function getPayloadFromValues() {
    return {
      name: values.name,
      slug: values.slug,
      siteUrl: values.siteUrl,
      siteDirectory: values.siteDirectory,
      backupDestination: values.backupDestination,
      dbContainerName: values.dbContainerName,
      dbName: values.dbName,
      dbUser: values.dbUser,
      dbPassword: values.dbPassword,
      wordpressContainerName: values.wordpressContainerName,
      uploadsPath: values.uploadsPath,
      notes: values.notes,
      backupFrequency: values.backupFrequency,
      backupTime: values.backupTime,
      timezone: values.timezone,
      cronExpression: values.cronExpression,
      retentionCount: Number(values.retentionCount),
      retentionDays: values.retentionDays ? Number(values.retentionDays) : null,
      backupMode: values.backupMode,
      active,
      scheduleEnabled,
      neverDeleteNewest
    };
  }

  async function runPathValidation() {
    setTesting(true);
    setMessage(null);
    const response = await fetch("/api/sites/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getPayloadFromValues())
    });
    const data = await response.json().catch(() => ({}));
    setTesting(false);

    if (!response.ok) {
      setMessageTone("error");
      setMessage(data.error ?? "Path test failed");
      return null;
    }

    setPathChecks(data.checks ?? []);
    const failedCount = (data.checks ?? []).filter((check: PathCheck) => check.status === "fail").length;
    setMessageTone(failedCount ? "warn" : "success");
    setMessage(failedCount ? "Path test completed with issues to review." : "Path test passed. StackPress can see the required paths and containers.");
    return data as { checks: PathCheck[]; canSave: boolean };
  }

  async function createBackupDestination() {
    setCreatingFolder(true);
    const response = await fetch("/api/filesystem/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: values.backupDestination })
    });
    const data = await response.json().catch(() => ({}));
    setCreatingFolder(false);

    if (!response.ok) {
      setMessageTone("error");
      setMessage(data.error ?? "Unable to create folder");
      return;
    }

    setMessageTone("success");
    setMessage(`Created ${data.path}.`);
    await runPathValidation();
  }

  async function applyDetection(composePath: string) {
    setDetecting(true);
    setMessage(null);
    setMessageTone("success");
    setFallbackConfirmed(false);
    const response = await fetch(detectEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ composePath })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessageTone("error");
      setMessage(data.error ?? "Detection failed");
      setDetecting(false);
      return;
    }

    setValues((current) => ({
      ...current,
      name: data.siteName ?? current.name,
      slug: data.slug ?? current.slug,
      siteDirectory: data.siteDirectory ?? current.siteDirectory,
      backupDestination: current.backupDestination || data.suggestedBackupDestination || current.backupDestination,
      dbContainerName: data.dbContainerName ?? current.dbContainerName,
      dbName: data.dbName ?? current.dbName,
      dbUser: data.dbUser ?? current.dbUser,
      dbPassword: data.dbPassword ?? current.dbPassword,
      wordpressContainerName: data.wordpressContainerName ?? current.wordpressContainerName,
      uploadsPath: data.uploadsPath ?? current.uploadsPath
    }));
    setDetectedVolumeMounts(data.volumeMounts ?? []);
    setFallbackGuesses(data.fallbackGuesses ?? []);
    if (Array.isArray(data.warnings) && data.warnings.length > 0) {
      setMessageTone("warn");
      setMessage(`Detected site settings with warnings: ${data.warnings.join(" ")}`);
    } else {
      setMessageTone("success");
      setMessage("Docker compose settings detected and applied.");
    }
    setDetecting(false);
  }

  function openPicker(target: NonNullable<PathPickerTarget>) {
    setPicker(target);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});

    if (fallbackGuesses.length > 0 && !fallbackConfirmed) {
      setMessageTone("warn");
      setMessage("Confirm the fallback guesses before saving. StackPress could not prove those values from docker-compose.yml.");
      return;
    }

    const validation = await runPathValidation();
    const siteDirectoryFailed = validation?.checks.some((check) => check.key === "siteDirectory" && check.status === "fail");
    if (siteDirectoryFailed) {
      setMessageTone("error");
      setMessage("StackPress cannot see this folder. Make sure the parent folder is mounted into the StackPress container.");
      return;
    }

    const payload = getPayloadFromValues();

    startTransition(async () => {
      const response = await fetch(submitEndpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageTone("error");
        setMessage(data.error ?? "Save failed");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      router.refresh();
      router.push(data.redirectTo ?? "/sites");
    });
  }

  function getFieldClassName(field: string, extra = "") {
    return `${fieldErrors[field] ? "border-rose-400/45" : ""} ${extra}`.trim();
  }

  function renderFieldError(field: string) {
    return fieldErrors[field] ? (
      <p className="mt-2 text-sm text-rose-200">{fieldErrors[field]}</p>
    ) : null;
  }

  const messageClassName =
    messageTone === "error"
      ? "text-rose-200"
      : messageTone === "warn"
        ? "text-amber-200"
        : "text-emerald-200";

  const backupDestinationMissing = pathChecks.find((check) => check.key === "backupDestination" && check.status === "fail" && check.canCreate);

  return (
    <>
      {picker ? (
        <PathPickerDialog
          key={`${picker.field}-${picker.initialPath}`}
          picker={picker}
          onClose={() => setPicker(null)}
          onSelect={(selectedPath) => {
            if (picker.field === "composePath") {
            setPicker(null);
            applyDetection(selectedPath);
            return;
          }

            updateField(picker.field, selectedPath);
            setPicker(null);
          }}
        />
      ) : null}

      <form onSubmit={onSubmit} className="space-y-6">
        <SectionCard
          title="Site Identity"
          description="Basic label and identifier for this WordPress stack."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Site Name <span className="text-rose-300">*</span></span>
              <input className={getFieldClassName("name", "input")} name="name" value={values.name} onChange={(e) => updateField("name", e.target.value)} placeholder="My WordPress Site" />
              {renderFieldError("name")}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Site Slug <span className="text-rose-300">*</span></span>
              <input className={getFieldClassName("slug", "input")} name="slug" value={values.slug} onChange={(e) => updateField("slug", e.target.value)} placeholder="my-wordpress-site" />
              {renderFieldError("slug")}
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-2 block text-sm font-medium text-slate-200">Site URL</span>
              <input className={getFieldClassName("siteUrl", "input")} name="siteUrl" value={values.siteUrl} onChange={(e) => updateField("siteUrl", e.target.value)} placeholder="https://example.local" spellCheck={false} />
              <p className="mt-2 text-xs text-slate-500">Used for Open Site, WP Admin, and manual health checks.</p>
              {renderFieldError("siteUrl")}
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-2 block text-sm font-medium text-slate-200">Notes</span>
              <textarea className="textarea min-h-32" name="notes" value={values.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Optional notes for this stack, host, or restore quirks." />
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Paths & Storage"
          description="Use container-visible paths such as /mnt/wp-sites and /mnt/wp-backups."
        >
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-50">
            <p className="font-medium">Container Path Helper</p>
            <p className="mt-2 text-cyan-50/80">Use the container path in StackPress fields. These are the mounts StackPress can currently see.</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {mounts.length > 0 ? mounts.slice(0, 8).map((mount) => (
                <div key={`${mount.containerPath}-${mount.hostPath}`} className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">Host / Source</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-200">{mount.hostPath}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-cyan-200/80">Container</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-100">{mount.containerPath}</p>
                </div>
              )) : <p className="text-sm text-cyan-50/80">No useful mounts were reported by the runtime.</p>}
            </div>
          </div>

          <div className="mt-5 grid gap-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Site Directory <span className="text-rose-300">*</span></span>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input className={getFieldClassName("siteDirectory", "input font-mono text-sm")} name="siteDirectory" value={values.siteDirectory} onChange={(e) => updateField("siteDirectory", e.target.value)} placeholder="/mnt/wp-sites/example-site" spellCheck={false} />
                <PickerButton label="Browse" onClick={() => openPicker({ field: "siteDirectory", mode: "directory", title: "Choose Site Directory", initialPath: values.siteDirectory || "/mnt" })} />
              </div>
              {renderFieldError("siteDirectory")}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Backup Destination <span className="text-rose-300">*</span></span>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input className={getFieldClassName("backupDestination", "input font-mono text-sm")} name="backupDestination" value={values.backupDestination} onChange={(e) => updateField("backupDestination", e.target.value)} placeholder="/mnt/wp-backups/example-site" spellCheck={false} />
                <PickerButton label="Browse" onClick={() => openPicker({ field: "backupDestination", mode: "directory", title: "Choose Backup Destination", initialPath: values.backupDestination || "/mnt" })} />
              </div>
              {renderFieldError("backupDestination")}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-200">Uploads Path <span className="text-rose-300">*</span></span>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input className={getFieldClassName("uploadsPath", "input font-mono text-sm")} name="uploadsPath" value={values.uploadsPath} onChange={(e) => updateField("uploadsPath", e.target.value)} placeholder="/mnt/wp-sites/example-site/html/wp-content/uploads" spellCheck={false} />
                <PickerButton label="Browse" onClick={() => openPicker({ field: "uploadsPath", mode: "directory", title: "Choose Uploads Path", initialPath: values.uploadsPath || values.siteDirectory || "/mnt" })} />
              </div>
              {renderFieldError("uploadsPath")}
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => openPicker({ field: "composePath", mode: "file", title: "Select docker-compose.yml", initialPath: values.siteDirectory || "/mnt" })} className="btn btn-secondary inline-flex items-center justify-center gap-2" disabled={detecting}>
              <FileSearch aria-hidden="true" className="h-4 w-4" />
              <span>{detecting ? "Detecting..." : "Auto-Detect docker-compose"}</span>
            </button>
            <button type="button" onClick={runPathValidation} className="btn btn-primary" disabled={testing}>
              {testing ? "Testing..." : "Test Backup Paths"}
            </button>
          </div>

          {detectedVolumeMounts.length > 0 ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-medium text-slate-200">Detected compose volume mounts</p>
              <div className="mt-3 grid gap-2 text-xs text-slate-400">
                {detectedVolumeMounts.map((mount, index) => (
                  <p key={`${mount.service}-${mount.target}-${index}`} className="break-all font-mono">{mount.service}: {mount.source} → {mount.target}</p>
                ))}
              </div>
            </div>
          ) : null}

          {fallbackGuesses.length > 0 ? (
            <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p className="font-medium">Fallback guesses need confirmation</p>
              <div className="mt-3 space-y-2">
                {fallbackGuesses.map((guess) => (
                  <p key={guess.field} className="break-all"><span className="font-medium">{fieldLabel(guess.field)}:</span> {guess.value} <span className="text-amber-50/70">({guess.reason})</span></p>
                ))}
              </div>
              <label className="mt-4 flex items-start gap-3">
                <input type="checkbox" checked={fallbackConfirmed} onChange={(event) => setFallbackConfirmed(event.target.checked)} />
                <span>I reviewed these fallback guesses and want to save them.</span>
              </label>
            </div>
          ) : null}

          {pathChecks.length > 0 ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {pathChecks.map((check) => <CheckBadge key={check.key} check={check} />)}
            </div>
          ) : null}

          {backupDestinationMissing ? (
            <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p>Folder does not exist. Create it?</p>
              <button type="button" className="btn btn-secondary mt-3" onClick={createBackupDestination} disabled={creatingFolder}>
                {creatingFolder ? "Creating..." : "Create Folder"}
              </button>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Docker & Database" description="Container and database credentials used for backup and restore commands.">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">DB Container <span className="text-rose-300">*</span></span><input className={getFieldClassName("dbContainerName", "input font-mono text-sm")} name="dbContainerName" value={values.dbContainerName} onChange={(e) => updateField("dbContainerName", e.target.value)} spellCheck={false} />{renderFieldError("dbContainerName")}</label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">WordPress Container <span className="text-rose-300">*</span></span><input className={getFieldClassName("wordpressContainerName", "input font-mono text-sm")} name="wordpressContainerName" value={values.wordpressContainerName} onChange={(e) => updateField("wordpressContainerName", e.target.value)} spellCheck={false} />{renderFieldError("wordpressContainerName")}</label>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">DB Name <span className="text-rose-300">*</span></span><input className={getFieldClassName("dbName", "input")} name="dbName" value={values.dbName} onChange={(e) => updateField("dbName", e.target.value)} />{renderFieldError("dbName")}</label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">DB User <span className="text-rose-300">*</span></span><input className={getFieldClassName("dbUser", "input")} name="dbUser" value={values.dbUser} onChange={(e) => updateField("dbUser", e.target.value)} />{renderFieldError("dbUser")}</label>
            <label className="block md:col-span-2 xl:col-span-1"><span className="mb-2 block text-sm font-medium text-slate-200">DB Password <span className="text-rose-300">*</span></span><input className={getFieldClassName("dbPassword", "input")} name="dbPassword" value={values.dbPassword} onChange={(e) => updateField("dbPassword", e.target.value)} />{renderFieldError("dbPassword")}</label>
          </div>
        </SectionCard>

        <SectionCard title="Backup Schedule" description="Choose when StackPress should run automatic backups.">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Backup Frequency</span><select className="select" name="backupFrequency" value={values.backupFrequency} onChange={(e) => updateField("backupFrequency", e.target.value)}><option value="manual">Manual</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="cron">Cron Expression</option></select></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Backup Time</span><input className="input" type="time" name="backupTime" value={values.backupTime} onChange={(e) => updateField("backupTime", e.target.value)} /></label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Timezone <span className="text-rose-300">*</span></span><input className={getFieldClassName("timezone", "input")} name="timezone" value={values.timezone} onChange={(e) => updateField("timezone", e.target.value)} spellCheck={false} />{renderFieldError("timezone")}</label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Cron Expression</span><input className="input font-mono text-sm" name="cronExpression" value={values.cronExpression} onChange={(e) => updateField("cronExpression", e.target.value)} placeholder="0 2 * * *" spellCheck={false} /></label>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4"><label className="flex items-start gap-3 text-sm text-slate-200"><input type="checkbox" name="scheduleEnabled" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} /><span>Enable Schedule<span className="mt-1 block text-xs text-slate-400">StackPress will only schedule this site when the site is active and the backup frequency is not Manual.</span></span></label></div>
        </SectionCard>

        <SectionCard title="Retention & Cleanup" description="Controls how many backup points StackPress keeps.">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Retention Count <span className="text-rose-300">*</span></span><input className={getFieldClassName("retentionCount", "input")} type="number" min="1" max="100" name="retentionCount" value={values.retentionCount} onChange={(e) => updateField("retentionCount", e.target.value)} />{renderFieldError("retentionCount")}</label>
            <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Delete Older Than Days</span><input className="input" type="number" min="1" name="retentionDays" value={values.retentionDays} onChange={(e) => updateField("retentionDays", e.target.value)} /></label>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4"><label className="flex items-start gap-3 text-sm text-slate-200"><input type="checkbox" name="neverDeleteNewest" checked={neverDeleteNewest} onChange={(e) => setNeverDeleteNewest(e.target.checked)} /><span>Never Delete Newest<span className="mt-1 block text-xs text-slate-400">Keeps the most recent successful backup even when other retention rules would remove it.</span></span></label></div>
          <p className="mt-4 text-xs text-slate-500">Retention cleanup applies to StackPress-tracked backups in the standardized /site-slug/stackpress folder. Legacy duplicate folders are left untouched unless you remove them manually.</p>
        </SectionCard>

        <SectionCard title="Backup Mode" description="Choose what gets backed up and whether this site is active.">
          <div className="space-y-5">
            <label className="block max-w-xl"><span className="mb-2 block text-sm font-medium text-slate-200">Backup Mode <span className="text-rose-300">*</span></span><select className="select" name="backupMode" value={values.backupMode} onChange={(e) => updateField("backupMode", e.target.value)}><option value="full">Full Backup</option><option value="database">Database Only</option><option value="files">Files Only</option></select></label>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><label className="flex items-start gap-3 text-sm text-slate-200"><input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Site Active<span className="mt-1 block text-xs text-slate-400">Inactive sites stay in StackPress but are skipped by bulk and scheduled backup flows.</span></span></label></div>
          </div>
        </SectionCard>

        {message ? <div className={`rounded-2xl border px-4 py-3 text-sm ${messageTone === "error" ? "border-rose-400/25 bg-rose-400/10" : messageTone === "warn" ? "border-amber-400/25 bg-amber-400/10" : "border-emerald-400/20 bg-emerald-400/10"}`}><p className={messageClassName}>{message}</p></div> : null}

        <div className="border-t border-white/10 pt-2">
          <p className="text-sm text-slate-400">Review the detected paths and container names before saving. StackPress tests container-visible paths before it saves.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button type="submit" className="btn btn-primary w-full min-h-12" disabled={pending || testing}>{pending ? "Saving..." : "Save Site"}</button>
            <button type="button" className="btn btn-secondary w-full min-h-12" onClick={() => router.push("/sites")}>Cancel</button>
          </div>
        </div>
      </form>
    </>
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

type RestoreBackupButtonProps = {
  endpoint: string;
  label?: string;
  backupType: string;
  backupTimestamp: string;
  dbDumpPath?: string | null;
  filesArchivePath?: string | null;
  detailMessage?: string | null;
};

export function RestoreBackupButton({
  endpoint,
  label = "Restore",
  backupType,
  backupTimestamp,
  dbDumpPath,
  filesArchivePath,
  detailMessage
}: RestoreBackupButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [snapshotFailure, setSnapshotFailure] = useState<string | null>(null);
  const [createSafetySnapshot, setCreateSafetySnapshot] = useState(true);

  const localValidationError = useMemo(
    () => getRestoreValidation(backupType, dbDumpPath, filesArchivePath),
    [backupType, dbDumpPath, filesArchivePath]
  );

  async function submitRestore(continueWithoutSafetySnapshot: boolean) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createSafetySnapshot,
        continueWithoutSafetySnapshot
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409 && data.snapshotFailure) {
        setSnapshotFailure(data.error ?? "Safety snapshot failed");
        setError(null);
        return;
      }

      setError(data.error ?? "Restore failed");
      setSnapshotFailure(null);
      return;
    }

    setSnapshotFailure(null);
    setError(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button className="btn btn-secondary" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
          <div className="panel w-full max-w-2xl rounded-3xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-amber-300/80">Destructive Restore</p>
                <h3 className="mt-2 text-2xl font-semibold">Restore Selected Backup</h3>
                <p className="mt-2 text-sm text-slate-400">
                  This will stop containers, overwrite current site data, and restore the selected recovery point.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setSnapshotFailure(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-slate-400">Backup timestamp</p>
                <p className="mt-2 text-base text-slate-100">{backupTimestamp}</p>
                <p className="mt-4 text-sm text-slate-400">Backup type</p>
                <p className="mt-2 text-base text-slate-100 capitalize">{backupType}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-slate-400">Artifacts</p>
                <div className="mt-2 space-y-2 text-sm text-slate-200">
                  <p>DB: {basename(dbDumpPath) ?? "Missing"}</p>
                  <p>Files: {basename(filesArchivePath) ?? "Missing"}</p>
                </div>
              </div>
            </div>

            {detailMessage ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-slate-400">Backup notes</p>
                <p className="mt-2 text-sm text-slate-200">{detailMessage}</p>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              Restores are destructive. Current WordPress files and database state will be replaced by the selected backup. A safety snapshot can give you an emergency rollback point if you need to undo the restore.
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={createSafetySnapshot}
                disabled={pending}
                onChange={(event) => setCreateSafetySnapshot(event.target.checked)}
              />
              <span>
                Create safety snapshot before restore
                <span className="mt-1 block text-xs text-slate-400">
                  StackPress will save a pre-restore database dump and try to archive the current site files under the site&apos;s `stackpress/pre-restore` folder.
                </span>
              </span>
            </label>

            {localValidationError ? (
              <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
                {localValidationError}
              </div>
            ) : null}

            {snapshotFailure ? (
              <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
                <p>{snapshotFailure}</p>
                <p className="mt-2 text-xs text-amber-50/80">
                  The restore has not started yet. You can continue without the safety snapshot or cancel and investigate first.
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="btn btn-danger"
                type="button"
                disabled={pending || Boolean(localValidationError)}
                onClick={() => {
                  setError(null);
                  setSnapshotFailure(null);
                  startTransition(async () => {
                    await submitRestore(false);
                  });
                }}
              >
                {pending ? "Restoring..." : "Confirm Restore"}
              </button>
              {snapshotFailure ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      await submitRestore(true);
                    });
                  }}
                >
                  {pending ? "Restoring..." : "Continue Without Snapshot"}
                </button>
              ) : null}
              <button
                className="btn btn-secondary"
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setSnapshotFailure(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
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
