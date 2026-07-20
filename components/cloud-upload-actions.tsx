"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type RemoteBackupAction = "upload" | "retry" | "verify" | "download" | "delete" | "restore";
export const REMOTE_DELETE_CONFIRMATION = "Delete only the remote copy? The local backup will remain unchanged.";

export function remoteActionRequest(backupId: string, connectionId: string, action: RemoteBackupAction, uploadId?: string) {
  if (action === "upload") return {
    url: `/api/backups/${backupId}/cloud-uploads`,
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cloudConnectionId: connectionId }) }
  };
  if (action === "retry") return { url: `/api/cloud-storage/uploads/${uploadId}/retry`, init: { method: "POST" } };
  return { url: `/api/backups/${backupId}/cloud/${connectionId}/${action}`, init: { method: "POST" } };
}

export function CloudBackupActions({
  backupId,
  connectionId,
  uploadId,
  uploadStatus,
  restoreStatus,
  hasRemoteCopy,
  remoteVerified,
  localAvailable,
  openUrl
}: {
  backupId: string;
  connectionId: string;
  uploadId?: string;
  uploadStatus?: string;
  restoreStatus?: string;
  hasRemoteCopy: boolean;
  remoteVerified?: boolean;
  localAvailable: boolean;
  openUrl?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<RemoteBackupAction | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function run(action: RemoteBackupAction) {
    if (action === "delete" && !window.confirm(REMOTE_DELETE_CONFIRMATION)) return;
    if (action === "restore" && !window.confirm("Download this verified remote copy and restore the site now?")) return;
    setPending(action);
    setMessage(null);
    try {
      const request = remoteActionRequest(backupId, connectionId, action, uploadId);
      const response = await fetch(request.url, request.init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Unable to ${action} remote copy`);
      setMessage({ error: false, text: action === "download" ? `Downloaded to ${body.download?.destinationDirectory ?? "temporary storage"}.` : action === "restore" ? "Remote restore queued in the background." : `${action[0].toUpperCase()}${action.slice(1)} completed.` });
      router.refresh();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Remote action failed" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {!hasRemoteCopy && !["queued", "running"].includes(uploadStatus ?? "") ? (
          <button className="btn btn-secondary" type="button" disabled={Boolean(pending)} onClick={() => run(uploadId ? "retry" : "upload")}>
            {pending ? "Queueing…" : uploadId ? "Retry upload" : "Upload to Google Drive"}
          </button>
        ) : null}
        {hasRemoteCopy ? <button className="btn btn-secondary" type="button" disabled={Boolean(pending)} onClick={() => run("verify")}>Verify remote copy</button> : null}
        {hasRemoteCopy ? <button className="btn btn-secondary" type="button" disabled={Boolean(pending)} onClick={() => run("download")}>Download from Google Drive</button> : null}
        {hasRemoteCopy && remoteVerified && !localAvailable ? <button className="btn btn-primary" type="button" disabled={Boolean(pending) || ["queued", "running"].includes(restoreStatus ?? "")} onClick={() => run("restore")}>{["queued", "running"].includes(restoreStatus ?? "") ? "Remote restore in progress" : "Restore remote copy"}</button> : null}
        {openUrl ? <a className="btn btn-secondary" href={openUrl} target="_blank" rel="noreferrer">Open in Google Drive</a> : null}
        {hasRemoteCopy ? <button className="btn btn-danger" type="button" disabled={Boolean(pending)} onClick={() => run("delete")}>Delete remote copy</button> : null}
      </div>
      {message ? <p className={`mt-3 text-sm ${message.error ? "text-rose-200" : "text-emerald-200"}`} role={message.error ? "alert" : "status"}>{message.text}</p> : null}
    </div>
  );
}

export function RetryCloudUploadButton({ uploadId }: { uploadId: string }) {
  return <CloudBackupActions backupId="" connectionId="" uploadId={uploadId} uploadStatus="failed" hasRemoteCopy={false} localAvailable />;
}
