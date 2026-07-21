import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CloudProviderError } from "./types";
import {
  classifyCloudUploadFailure,
  cloudUploadDedupeKey,
  isStaleCloudUpload
} from "./upload-jobs";
import {
  artifactLifecycleMessage,
  assertRequiredBackupArtifactPaths,
  requiredBackupArtifactKinds
} from "./types";

describe("cloud upload workflow decisions", () => {
  test("cloud failure after local success remains a cloud-only failed state", () => {
    assert.equal(classifyCloudUploadFailure(new Error("Drive unavailable"), 1, 4), "failed");
  });

  test("retryable failure is queued for another attempt", () => {
    const error = new CloudProviderError({
      providerType: "google_drive",
      code: "connection_failed",
      message: "Temporary network failure",
      retryable: true
    });
    assert.equal(classifyCloudUploadFailure(error, 1, 4), "queued");
    assert.equal(classifyCloudUploadFailure(error, 4, 4), "failed");
  });

  test("duplicate jobs use the same backup and connection idempotency key", () => {
    assert.equal(cloudUploadDedupeKey("backup-1", "drive-1"), cloudUploadDedupeKey("backup-1", "drive-1"));
    assert.notEqual(cloudUploadDedupeKey("backup-1", "drive-1"), cloudUploadDedupeKey("backup-1", "drive-2"));
  });

  test("revoked Google credentials require authentication rather than endless retries", () => {
    const error = new CloudProviderError({
      providerType: "google_drive",
      code: "authentication_failed",
      message: "Google credentials were revoked"
    });
    assert.equal(classifyCloudUploadFailure(error, 1, 4), "needs_auth");
  });

  test("application restart recovers only stale running work", () => {
    const now = new Date("2026-07-15T12:10:00.000Z");
    assert.equal(isStaleCloudUpload(null, now), true);
    assert.equal(isStaleCloudUpload(new Date("2026-07-15T12:00:00.000Z"), now), true);
    assert.equal(isStaleCloudUpload(new Date("2026-07-15T12:09:00.000Z"), now), false);
  });

  test("full backups require and report both database and files artifacts", () => {
    const fullBackup = {
      backupType: "full",
      dbDumpPath: "/backups/db.sql",
      filesArchivePath: "/backups/files.tar.gz",
      manifestPath: "/backups/manifest.json"
    };
    assert.doesNotThrow(() => assertRequiredBackupArtifactPaths(fullBackup));
    assert.deepEqual(requiredBackupArtifactKinds("full"), ["database", "files"]);
    assert.equal(
      artifactLifecycleMessage("Queued upload artifacts", requiredBackupArtifactKinds("full")),
      "Queued upload artifacts: database, files"
    );
    assert.throws(
      () => assertRequiredBackupArtifactPaths({ ...fullBackup, filesArchivePath: null }),
      /missing required files artifact/
    );
  });
});
