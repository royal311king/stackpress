"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type DetectedSite = {
  folderName: string;
  name: string;
  slug: string;
  siteDirectory: string;
  uploadsPath: string;
  backupDestination: string;
  wordpressContainerName: string;
  dbContainerName: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  mappedHostPort: string | null;
  siteUrl: string;
  publicUrl: string;
  cloudflareServiceTarget: string;
  containerStatus: "running" | "stopped" | "unknown";
  needsReview: string[];
  warnings: string[];
  existingSiteId: string | null;
};

function updateSiteField(sites: DetectedSite[], index: number, field: keyof DetectedSite, value: string) {
  return sites.map((site, siteIndex) => {
    if (siteIndex !== index) return site;
    const next = { ...site, [field]: value };
    if (field === "dbPassword" && value.trim()) {
      next.needsReview = next.needsReview.filter((item) => item !== "dbPassword");
    }
    return next;
  });
}

export function SiteAutoDetectButton({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sites, setSites] = useState<DetectedSite[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scanSites() {
    setOpen(true);
    setScanning(true);
    setMessage(null);
    setError(null);
    const response = await fetch("/api/sites/auto-detect");
    const data = await response.json().catch(() => ({}));
    setScanning(false);

    if (!response.ok) {
      setSites([]);
      setSelected({});
      setError(data.error ?? "Auto-detect failed");
      return;
    }

    setSites(data.sites ?? []);
    setSelected(Object.fromEntries((data.sites ?? []).map((site: DetectedSite) => [site.slug, !site.existingSiteId && !site.needsReview.includes("dbPassword")])));
    setMessage(`Found ${(data.sites ?? []).length} WordPress Docker sites in ${data.rootPath}.`);
  }

  function selectedSites() {
    return sites.filter((site) => selected[site.slug]);
  }

  async function importSelected() {
    setError(null);
    setMessage(null);

    const rows = selectedSites();
    if (rows.length === 0) {
      setError("Select at least one detected site to import.");
      return;
    }

    if (overwriteExisting && !window.confirm("Overwrite existing StackPress site configs with matching slugs?")) {
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/sites/import-detected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sites: rows, overwriteExisting })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Import failed");
        return;
      }

      setMessage(data.message ?? "Imported selected WordPress sites into StackPress.");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={`btn btn-primary ${fullWidth ? "w-full" : ""}`} onClick={scanSites}>
        Auto-Detect Sites
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
          <div className="panel flex max-h-[86vh] w-full max-w-6xl flex-col rounded-3xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">WordPress stack scan</p>
                <h3 className="mt-2 text-2xl font-semibold">Review Detected Sites</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Auto-detect scans /mnt/wp-sites for Docker Compose WordPress stacks. Make sure your host folder is mounted into the StackPress container.
                </p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Close</button>
            </div>

            {message ? <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">{message}</div> : null}
            {error ? <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div> : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-secondary" onClick={scanSites} disabled={scanning}>{scanning ? "Scanning..." : "Scan Again"}</button>
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
                <input type="checkbox" checked={overwriteExisting} onChange={(event) => setOverwriteExisting(event.target.checked)} />
                Update existing matching sites
              </label>
              <button type="button" className="btn btn-primary" onClick={importSelected} disabled={pending || scanning}>{pending ? "Importing..." : `Import Selected (${selectedSites().length})`}</button>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
              {scanning ? <p className="p-4 text-sm text-slate-400">Scanning /mnt/wp-sites...</p> : null}
              {!scanning && sites.length === 0 ? <p className="p-4 text-sm text-slate-400">No detected sites to review yet.</p> : null}
              {sites.length > 0 ? (
                <table>
                  <thead>
                    <tr>
                      <th>Import</th>
                      <th>Site Slug</th>
                      <th>Site Directory</th>
                      <th>WP Container</th>
                      <th>DB Container</th>
                      <th>DB Name / User</th>
                      <th>DB Password Status</th>
                      <th>Uploads Path</th>
                      <th>Backup Destination</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site, index) => {
                      const needsPassword = site.needsReview.includes("dbPassword");
                      const alreadyImported = Boolean(site.existingSiteId);
                      const importDisabled = needsPassword || (alreadyImported && !overwriteExisting);
                      return (
                        <tr key={site.slug}>
                          <td>
                            <input
                              type="checkbox"
                              checked={Boolean(selected[site.slug])}
                              onChange={(event) => setSelected((current) => ({ ...current, [site.slug]: event.target.checked }))}
                              disabled={importDisabled}
                            />
                          </td>
                          <td className="min-w-56 align-top">
                            <input className="input" value={site.name} onChange={(event) => setSites((current) => updateSiteField(current, index, "name", event.target.value))} />
                            <p className="mt-2 font-mono text-xs text-slate-500">{site.slug}</p>
                            {alreadyImported ? <p className="mt-2 text-xs text-amber-200">Already imported</p> : null}
                          </td>
                          <td className="min-w-80 align-top text-xs">
                            <p className="break-all font-mono text-slate-300">{site.siteDirectory}</p>
                          </td>
                          <td className="min-w-56 align-top text-xs">
                            <p className="break-all font-mono text-slate-300">{site.wordpressContainerName}</p>
                            <p className="mt-2 text-slate-400">Port: {site.mappedHostPort ?? "-"}</p>
                          </td>
                          <td className="min-w-56 align-top text-xs">
                            <p className="break-all font-mono text-slate-300">{site.dbContainerName}</p>
                          </td>
                          <td className="min-w-56 align-top">
                            <div className="space-y-2">
                              <input className="input" value={site.dbName} onChange={(event) => setSites((current) => updateSiteField(current, index, "dbName", event.target.value))} placeholder="DB name" />
                              <input className="input" value={site.dbUser} onChange={(event) => setSites((current) => updateSiteField(current, index, "dbUser", event.target.value))} placeholder="DB user" />
                            </div>
                          </td>
                          <td className="min-w-60 align-top">
                            <input className={`input ${needsPassword ? "border-amber-400/45" : ""}`} value={site.dbPassword} onChange={(event) => setSites((current) => updateSiteField(current, index, "dbPassword", event.target.value))} placeholder="DB password" />
                            <p className={`mt-2 text-xs ${needsPassword ? "text-amber-200" : "text-emerald-200"}`}>
                              {needsPassword ? "Needs review" : "Detected"}
                            </p>
                          </td>
                          <td className="min-w-80 align-top text-xs">
                            <p className="break-all font-mono text-slate-300">{site.uploadsPath}</p>
                          </td>
                          <td className="min-w-80 align-top text-xs">
                            <p className="break-all font-mono text-slate-300">{site.backupDestination}</p>
                            <div className="mt-3 space-y-2">
                              <input className="input" value={site.publicUrl || site.siteUrl} onChange={(event) => setSites((current) => updateSiteField(current, index, "publicUrl", event.target.value))} placeholder="Public URL optional" />
                              <input className="input" value={site.cloudflareServiceTarget} onChange={(event) => setSites((current) => updateSiteField(current, index, "cloudflareServiceTarget", event.target.value))} placeholder="Cloudflare target optional" />
                            </div>
                          </td>
                          <td className="min-w-52 align-top text-sm">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs uppercase tracking-[0.16em] text-slate-200">{alreadyImported && !overwriteExisting ? "already imported" : site.containerStatus}</span>
                            {site.warnings.length > 0 ? <div className="mt-3 space-y-1 text-xs text-amber-200">{site.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
