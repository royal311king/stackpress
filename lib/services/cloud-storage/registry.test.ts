import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { CloudStorageProvider } from "./provider";
import {
  clearCloudStorageProvidersForTests,
  createCloudStorageProvider,
  getRegisteredCloudProviderTypes,
  registerCloudStorageProvider
} from "./registry";
import {
  assertCloudUploadEligibleBackup,
  CloudProviderError,
  type CloudBackupSource,
  type CloudProviderContext,
  type RemoteBackupResult,
  type UploadProgress
} from "./types";

const context: CloudProviderContext = {
  connection: {
    id: "connection-1",
    name: "Primary Google Drive",
    providerType: "google_drive",
    enabled: true,
    config: { folderId: "folder-1" }
  },
  credentials: { accessToken: "server-only-token" }
};

const source: CloudBackupSource = {
  backup: {
    id: "backup-1",
    siteId: "site-1",
    status: "success",
    backupType: "full",
    startedAt: new Date("2026-07-15T12:00:00.000Z"),
    completedAt: new Date("2026-07-15T12:01:00.000Z"),
    totalBytes: BigInt(30),
    dbDumpPath: "/backups/site-1/db.sql",
    filesArchivePath: "/backups/site-1/files.tar.gz",
    manifestPath: "/backups/site-1/manifest.json"
  },
  site: {
    id: "site-1",
    name: "Example Site",
    slug: "example-site"
  }
};

function remoteResult(): RemoteBackupResult {
  return {
    backupId: source.backup.id,
    siteId: source.site.id,
    connectionId: context.connection.id,
    providerType: context.connection.providerType,
    remotePrefix: "StackPress/example-site/backup-1",
    uploadedAt: "2026-07-15T12:02:00.000Z",
    files: [
      {
        kind: "manifest",
        remoteId: "remote-manifest-1",
        name: "manifest.json",
        remotePath: "StackPress/example-site/backup-1/manifest.json",
        sizeBytes: 30,
        checksum: null,
        checksumAlgorithm: null,
        contentType: "application/json",
        webUrl: null,
        createdAt: "2026-07-15T12:02:00.000Z"
      }
    ]
  };
}

function fakeProvider(): CloudStorageProvider {
  return {
    async testConnection() {
      return {
        ok: true,
        message: "Connected",
        checkedAt: "2026-07-15T12:00:00.000Z"
      };
    },
    async uploadBackup(backupSource, onProgress) {
      assert.equal(backupSource.backup.id, "backup-1");
      await onProgress?.({
        backupId: backupSource.backup.id,
        currentFile: "manifest",
        currentFileBytesUploaded: 30,
        currentFileTotalBytes: 30,
        totalBytesUploaded: 30,
        totalBytes: 30,
        percent: 100
      });
      return remoteResult();
    },
    async downloadBackup(request) {
      return {
        backupId: request.remoteBackup.backupId,
        destinationDirectory: request.destinationDirectory,
        dbDumpPath: null,
        filesArchivePath: null,
        manifestPath: `${request.destinationDirectory}/manifest.json`
      };
    },
    async deleteBackup() {},
    async verifyBackupExists(request) {
      return request.remoteBackup.backupId === "backup-1";
    },
    async listRemoteBackups() {
      return { backups: [remoteResult()], nextCursor: null };
    }
  };
}

afterEach(() => {
  clearCloudStorageProvidersForTests();
});

describe("cloud storage provider registry", () => {
  test("registers and creates a provider for a configured connection", async () => {
    registerCloudStorageProvider("google_drive", (providerContext) => {
      assert.equal(providerContext.connection.id, "connection-1");
      assert.equal(providerContext.credentials.accessToken, "server-only-token");
      return fakeProvider();
    });

    assert.deepEqual(getRegisteredCloudProviderTypes(), ["google_drive"]);

    const provider = createCloudStorageProvider(context);
    const result = await provider.testConnection();

    assert.equal(result.ok, true);
    assert.equal(result.message, "Connected");
  });

  test("passes existing StackPress backup IDs and upload progress through the contract", async () => {
    registerCloudStorageProvider("google_drive", () => fakeProvider());
    const provider = createCloudStorageProvider(context);
    const progressEvents: UploadProgress[] = [];

    const uploaded = await provider.uploadBackup(source, (progress) => {
      progressEvents.push(progress);
    });

    assert.equal(uploaded.backupId, source.backup.id);
    assert.equal(uploaded.connectionId, context.connection.id);
    assert.equal(uploaded.files[0]?.remoteId, "remote-manifest-1");
    assert.deepEqual(progressEvents.map((entry) => entry.percent), [100]);
  });

  test("exposes download, verification, listing, and deletion operations", async () => {
    registerCloudStorageProvider("google_drive", () => fakeProvider());
    const provider = createCloudStorageProvider(context);
    const remoteBackup = remoteResult();

    assert.equal(await provider.verifyBackupExists({ remoteBackup }), true);
    assert.equal((await provider.listRemoteBackups()).backups.length, 1);
    assert.equal(
      (await provider.downloadBackup({
        remoteBackup,
        destinationDirectory: "/tmp/restore"
      })).manifestPath,
      "/tmp/restore/manifest.json"
    );
    await assert.doesNotReject(provider.deleteBackup({ remoteBackup }));
  });

  test("rejects duplicate registrations", () => {
    registerCloudStorageProvider("google_drive", () => fakeProvider());

    assert.throws(
      () => registerCloudStorageProvider("google_drive", () => fakeProvider()),
      (error: unknown) =>
        error instanceof CloudProviderError &&
        error.code === "conflict" &&
        error.providerType === "google_drive"
    );
  });

  test("returns a typed error when a provider is not registered", () => {
    assert.throws(
      () => createCloudStorageProvider(context),
      (error: unknown) =>
        error instanceof CloudProviderError &&
        error.code === "invalid_configuration" &&
        error.retryable === false
    );
  });
});

describe("CloudProviderError", () => {
  test("preserves provider, retry, details, and cause metadata", () => {
    const cause = new Error("socket closed");
    const error = new CloudProviderError({
      providerType: "google_drive",
      code: "connection_failed",
      message: "Google Drive connection failed",
      retryable: true,
      details: { status: 503 },
      cause
    });

    assert.equal(error.name, "CloudProviderError");
    assert.equal(error.providerType, "google_drive");
    assert.equal(error.code, "connection_failed");
    assert.equal(error.retryable, true);
    assert.deepEqual(error.details, { status: 503 });
    assert.equal(error.cause, cause);
  });
});

describe("cloud upload eligibility", () => {
  test("accepts only completed local backup statuses", () => {
    assert.doesNotThrow(() =>
      assertCloudUploadEligibleBackup({ id: "backup-1", status: "success" }, "google_drive")
    );
    assert.doesNotThrow(() =>
      assertCloudUploadEligibleBackup({ id: "backup-2", status: "success_with_warnings" }, "google_drive")
    );
    assert.throws(
      () => assertCloudUploadEligibleBackup({ id: "backup-3", status: "running" }, "google_drive"),
      CloudProviderError
    );
  });
});
