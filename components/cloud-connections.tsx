"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { SanitizedCloudConnection } from "@/lib/services/cloud-storage/connections-types";
import { formatTimestamp } from "@/lib/utils";

export type CloudProviderConnectionView = SanitizedCloudConnection & { siteCount: number };
export type CloudConnectionAction = "test" | "disable" | "disconnect";

export function cloudProviderListState(connections: readonly CloudProviderConnectionView[]) {
  return connections.length === 0 ? "empty" as const : "ready" as const;
}

export function googleReconnectUrl(connectionId: string) {
  return `/api/cloud-storage/google/start?connectionId=${encodeURIComponent(connectionId)}`;
}

export function connectionStatusLabel(status: string, pendingAction?: CloudConnectionAction | null) {
  if (pendingAction === "test") return "Testing";
  if (status === "needs_reauthorization") return "Needs Reauthorization";
  return status.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

export async function runCloudConnectionAction(
  connectionId: string,
  action: CloudConnectionAction,
  request: typeof fetch = fetch
) {
  const endpoint = action === "disconnect"
    ? `/api/cloud-storage/google/${connectionId}/disconnect`
    : `/api/cloud-storage/connections/${connectionId}/${action}`;
  const response = await request(endpoint, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Unable to ${action} connection`);
  return data;
}

export function CloudProviderConnections({ connections }: { connections: CloudProviderConnectionView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<{ id: string; action: CloudConnectionAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const googleConnections = connections.filter((connection) => connection.provider === "google_drive");

  async function act(connection: CloudProviderConnectionView, action: CloudConnectionAction) {
    if (action === "disconnect" && !window.confirm(
      `Disconnect ${connection.displayName}? Future uploads will stop, but existing remote and local backups will remain.`
    )) return;
    setPending({ id: connection.id, action });
    setError(null);
    setNotice(null);
    try {
      await runCloudConnectionAction(connection.id, action);
      setNotice(action === "test"
        ? `${connection.displayName} passed its connection test.`
        : `${connection.displayName} was ${action === "disable" ? "disabled" : "disconnected"}.`);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Cloud provider action failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Google Drive</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            StackPress can manage only the Drive files it creates. Tokens and credentials are never displayed here.
          </p>
        </div>
        <a className="btn btn-primary" href="/api/cloud-storage/google/start">Connect Google Drive</a>
      </div>

      {notice ? <p className="mt-4 rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" role="status">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-400/10 px-4 py-3 text-sm text-rose-100" role="alert">{error}</p> : null}

      {googleConnections.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-medium text-slate-200">No cloud providers connected</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
            Local backups continue normally. Connect Google Drive when you want selected sites to create cloud copies.
          </p>
          <a className="btn btn-secondary mt-5" href="/api/cloud-storage/google/start">Connect your first account</a>
        </div>
      ) : (
        <div className="mt-1 divide-y divide-white/10">
          {googleConnections.map((connection) => {
            const pendingAction = pending?.id === connection.id ? pending.action : null;
            const unavailable = connection.status === "disabled" || connection.status === "needs_reauthorization";
            return (
              <article key={connection.id} className="py-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-medium text-slate-100">{connection.displayName}</h3>
                      <StatusBadge value={pendingAction === "test" ? "testing" : connection.status} />
                    </div>
                    <p className="mt-2 break-all text-sm text-slate-300">
                      {connection.accountEmail ?? "Google account email unavailable"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Google Drive · {connectionStatusLabel(connection.status, pendingAction)}</p>
                  </div>

                  <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-3 xl:w-[34rem]">
                    <div>
                      <dt className="text-slate-500">Last successful test</dt>
                      <dd className="mt-1 text-slate-200">{connection.lastSuccessfulTestAt ? formatTimestamp(connection.lastSuccessfulTestAt) : "Never"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Sites using account</dt>
                      <dd className="mt-1 text-slate-200">{connection.siteCount}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Last error</dt>
                      <dd className={`mt-1 break-words ${connection.lastError ? "text-rose-200" : "text-slate-200"}`}>
                        {connection.lastError ?? "None"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {unavailable ? (
                  <p className="mt-4 rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    {connection.status === "needs_reauthorization"
                      ? "Google authorization is no longer valid. Reconnect this account before uploads can resume."
                      : "This account is disabled. Existing remote backups remain unchanged."}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn btn-secondary" type="button" disabled={Boolean(pendingAction) || connection.status !== "connected"} onClick={() => act(connection, "test")}>
                    {pendingAction === "test" ? "Testing…" : "Test connection"}
                  </button>
                  <a className="btn btn-secondary" href={googleReconnectUrl(connection.id)}>Reconnect</a>
                  <button className="btn btn-secondary" type="button" disabled={Boolean(pendingAction) || connection.status === "disabled"} onClick={() => act(connection, "disable")}>
                    {pendingAction === "disable" ? "Disabling…" : "Disable"}
                  </button>
                  <button className="btn btn-danger" type="button" disabled={Boolean(pendingAction)} onClick={() => act(connection, "disconnect")}>
                    {pendingAction === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
