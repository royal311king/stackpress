import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isRetentionProtected, shouldExpireBackup } from "../backup";
import { cleanupRemoteCopiesForExpiredBackup, type RemoteRetentionDependencies } from "./remote-retention";

type FileState = { id: string; cloudConnectionId: string; verificationStatus: string; deletionStatus: string; lastError?: string | null };

function dependencies(options: {
  policy?: "delete_with_local" | "retain_remote";
  connected?: boolean;
  files?: FileState[];
  deleteCopy?: (files: FileState[]) => Promise<void>;
  activeUpload?: boolean;
} = {}) {
  const files = options.files ?? [{ id: "file-1", cloudConnectionId: "drive-1", verificationStatus: "verified", deletionStatus: "not_requested" }];
  const deps: RemoteRetentionDependencies = {
    async destinations() { return [{ cloudConnectionId: "drive-1", retentionPolicy: options.policy ?? "delete_with_local" }]; },
    async files() { return files.map((file) => ({ ...file })); },
    async connection() { return options.connected === false ? { id: "drive-1", enabled: false, status: "disabled" } : { id: "drive-1", enabled: true, status: "connected" }; },
    async hasActiveUpload() { return Boolean(options.activeUpload); },
    async hasActiveRestore() { return false; },
    async updateFiles(ids, patch) { for (const file of files.filter((item) => ids.includes(item.id))) Object.assign(file, patch); },
    async deleteCopy() { await (options.deleteCopy?.(files) ?? Promise.resolve()); }
  };
  return { deps, files };
}

describe("remote retention integration", () => {
  test("mirrors the existing count and age expiration decision", () => {
    const now = new Date("2026-07-15T12:00:00.000Z").getTime();
    assert.equal(shouldExpireBackup({ index: 10, retentionCount: 10, retentionDays: null, completedAt: new Date(now), now }).expired, true);
    assert.equal(shouldExpireBackup({ index: 0, retentionCount: 10, retentionDays: 30, completedAt: new Date(now - 31 * 86400000), now }).expired, true);
    assert.equal(shouldExpireBackup({ index: 0, retentionCount: 10, retentionDays: 30, completedAt: new Date(now), now }).expired, false);
  });

  test("never expires pinned or newest-protected backups", () => {
    assert.equal(isRetentionProtected(true, false), true);
    assert.equal(isRetentionProtected(false, true), true);
    assert.equal(isRetentionProtected(false, false), false);
  });

  test("retains remote records and marks cleanup unavailable for disconnected providers", async () => {
    const { deps, files } = dependencies({ connected: false });
    assert.equal(await cleanupRemoteCopiesForExpiredBackup("backup-1", deps), false);
    assert.equal(files[0].deletionStatus, "cleanup_unavailable");
    assert.match(files[0].lastError ?? "", /reconnected/);
  });

  test("preserves per-file results after a partial deletion failure", async () => {
    const fileStates: FileState[] = [
      { id: "file-1", cloudConnectionId: "drive-1", verificationStatus: "verified", deletionStatus: "not_requested" },
      { id: "file-2", cloudConnectionId: "drive-1", verificationStatus: "verified", deletionStatus: "not_requested" }
    ];
    const { deps, files } = dependencies({
      files: fileStates,
      async deleteCopy(current) {
        current[0].deletionStatus = "deleted";
        throw new Error("Second Drive deletion failed");
      }
    });
    assert.equal(await cleanupRemoteCopiesForExpiredBackup("backup-1", deps), false);
    assert.equal(files[0].deletionStatus, "deleted");
    assert.equal(files[1].deletionStatus, "failed");
    assert.equal(files[1].lastError, "Second Drive deletion failed");
  });

  test("does not delete while upload or verification is active and honors retain-remote", async () => {
    let calls = 0;
    const active = dependencies({ activeUpload: true, deleteCopy: async () => { calls += 1; } });
    assert.equal(await cleanupRemoteCopiesForExpiredBackup("backup-1", active.deps), false);
    const verifying = dependencies({ files: [{ id: "f", cloudConnectionId: "drive-1", verificationStatus: "verifying", deletionStatus: "not_requested" }], deleteCopy: async () => { calls += 1; } });
    assert.equal(await cleanupRemoteCopiesForExpiredBackup("backup-1", verifying.deps), false);
    const retained = dependencies({ policy: "retain_remote", deleteCopy: async () => { calls += 1; } });
    assert.equal(await cleanupRemoteCopiesForExpiredBackup("backup-1", retained.deps), true);
    assert.equal(calls, 0);
  });
});
