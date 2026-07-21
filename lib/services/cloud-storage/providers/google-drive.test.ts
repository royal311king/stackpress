import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, test } from "node:test";

import type {
  CloudBackupFileKey,
  CloudBackupFilePatch,
  CloudBackupFileRecord,
  CloudBackupFileRepository,
  PendingCloudBackupFile
} from "../cloud-backup-files";
import type {
  GoogleDriveClient,
  GoogleDriveFile,
  GoogleDriveUploadInput
} from "../google-drive-client";
import type { CloudBackupSource, CloudProviderContext, RemoteFileKind } from "../types";
import { CloudProviderError } from "../types";
import { GoogleDriveProvider } from "./google-drive";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    fs.promises.rm(directory, { recursive: true, force: true })
  ));
});

class MemoryMetadataRepository implements CloudBackupFileRepository {
  records = new Map<string, CloudBackupFileRecord>();
  nextId = 1;

  private key(value: CloudBackupFileKey) {
    return `${value.cloudConnectionId}:${value.backupId}:${value.artifactKind}`;
  }

  async upsertPending(input: PendingCloudBackupFile) {
    const existing = this.records.get(this.key(input));
    const record: CloudBackupFileRecord = {
      id: existing?.id ?? `metadata-${this.nextId++}`,
      cloudConnectionId: input.cloudConnectionId,
      backupId: input.backupId,
      siteId: input.siteId,
      artifactKind: input.artifactKind,
      provider: input.provider,
      remoteFileId: existing?.remoteFileId ?? null,
      remoteFolderId: existing?.remoteFolderId ?? null,
      remoteName: input.remoteName,
      remoteSize: existing?.remoteSize ?? null,
      localSize: input.localSize,
      localChecksum: input.localChecksum,
      remoteChecksum: existing?.remoteChecksum ?? null,
      checksumAlgorithm: input.checksumAlgorithm,
      uploadStatus: "pending",
      uploadedAt: existing?.uploadedAt ?? null,
      verifiedAt: existing?.verifiedAt ?? null,
      verificationStatus: existing?.verificationStatus ?? "idle",
      deletionStatus: existing?.deletionStatus ?? "not_requested",
      deletionAttemptedAt: existing?.deletionAttemptedAt ?? null,
      deletedAt: existing?.deletedAt ?? null,
      lastError: null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date()
    };
    this.records.set(this.key(input), record);
    return record;
  }
  async findByKey(key: CloudBackupFileKey) { return this.records.get(this.key(key)) ?? null; }
  async findForBackup(connectionId: string, backupId: string) {
    return [...this.records.values()].filter(
      (record) => record.cloudConnectionId === connectionId && record.backupId === backupId
    );
  }
  async update(id: string, patch: CloudBackupFilePatch) {
    const entry = [...this.records.entries()].find(([, record]) => record.id === id);
    if (!entry) throw new Error("metadata not found");
    const updated = { ...entry[1], ...patch, updatedAt: new Date() };
    this.records.set(entry[0], updated);
    return updated;
  }
}

function hash(algorithm: "md5" | "sha256", content: Buffer) {
  return createHash(algorithm).update(content).digest("hex");
}

class MockGoogleDriveClient implements GoogleDriveClient {
  files = new Map<string, GoogleDriveFile>();
  contents = new Map<string, Buffer>();
  folderKeys = new Map<string, string>();
  createdFolderCount = 0;
  uploadAttempts = 0;
  deletedIds: string[] = [];
  uploadErrors: unknown[] = [];
  downloadErrors: unknown[] = [];
  downloadAttempts = 0;
  nextId = 1;

  private folderKey(name: string, parentId?: string) { return `${parentId ?? "root"}:${name}`; }

  async testConnection() { return { accountEmail: "admin@example.com" }; }
  async findFolder(name: string, parentId?: string) {
    const id = this.folderKeys.get(this.folderKey(name, parentId));
    return id ? this.files.get(id) ?? null : null;
  }
  async createFolder(name: string, parentId: string | undefined, appProperties: Readonly<Record<string, string>>) {
    this.createdFolderCount += 1;
    const file = this.file({ name, size: null, parents: parentId ? [parentId] : [], appProperties });
    this.files.set(file.id, file);
    this.folderKeys.set(this.folderKey(name, parentId), file.id);
    return file;
  }
  async findManagedBackupFile(backupId: string, artifactKind: string, parentId: string) {
    return [...this.files.values()].find((file) =>
      file.parents.includes(parentId) &&
      file.appProperties.stackpressBackupId === backupId &&
      file.appProperties.stackpressArtifactKind === artifactKind &&
      !file.trashed
    ) ?? null;
  }
  async uploadFile(input: GoogleDriveUploadInput) {
    this.uploadAttempts += 1;
    const queuedError = this.uploadErrors.shift();
    if (queuedError) throw queuedError;
    const content = await fs.promises.readFile(input.localPath);
    input.onProgress?.(Math.floor(content.length / 2));
    input.onProgress?.(content.length);
    const file = this.file({
      name: input.name,
      size: content.length,
      parents: [input.parentId],
      appProperties: input.appProperties,
      md5Checksum: hash("md5", content),
      sha256Checksum: hash("sha256", content)
    });
    this.files.set(file.id, file);
    this.contents.set(file.id, content);
    return file;
  }
  async getFile(fileId: string) { return this.files.get(fileId) ?? null; }
  async downloadFile(fileId: string, destinationPath: string, onProgress?: (bytes: number) => void) {
    this.downloadAttempts += 1;
    const content = this.contents.get(fileId);
    if (!content) throw Object.assign(new Error("not found"), { response: { status: 404 } });
    const queuedError = this.downloadErrors.shift();
    if (queuedError) {
      await fs.promises.writeFile(destinationPath, content.subarray(0, Math.max(1, Math.floor(content.length / 2))), { flag: "wx" });
      throw queuedError;
    }
    await fs.promises.writeFile(destinationPath, content, { flag: "wx" });
    onProgress?.(content.length);
  }
  async deleteFile(fileId: string) {
    this.deletedIds.push(fileId);
    this.files.delete(fileId);
    this.contents.delete(fileId);
  }
  async listManagedFiles(options: { siteId?: string } = {}) {
    const files = [...this.files.values()].filter((file) =>
      file.appProperties.stackpressManaged === "true" &&
      (!options.siteId || file.appProperties.stackpressSiteId === options.siteId)
    );
    return { files, nextPageToken: null };
  }
  private file(input: {
    name: string;
    size: number | null;
    parents: string[];
    appProperties: Readonly<Record<string, string>>;
    md5Checksum?: string;
    sha256Checksum?: string;
  }): GoogleDriveFile {
    return {
      id: `drive-${this.nextId++}`,
      name: input.name,
      size: input.size,
      md5Checksum: input.md5Checksum ?? null,
      sha256Checksum: input.sha256Checksum ?? null,
      webViewLink: null,
      createdTime: "2026-07-15T12:00:00.000Z",
      trashed: false,
      parents: input.parents,
      appProperties: input.appProperties
    };
  }
}

const context: CloudProviderContext = {
  connection: {
    id: "connection-1",
    name: "Google Drive",
    providerType: "google_drive",
    enabled: true,
    config: { rootFolderName: "StackPress Backups" }
  },
  credentials: { refresh_token: "encrypted-before-provider-construction" }
};

async function backupSource(backupId = "backup-1"): Promise<CloudBackupSource> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stackpress-google-test-"));
  tempDirectories.push(directory);
  const dbDumpPath = path.join(directory, "db.sql");
  const filesArchivePath = path.join(directory, "files.tar.gz");
  const manifestPath = path.join(directory, "manifest.json");
  await fs.promises.writeFile(dbDumpPath, "database-content");
  await fs.promises.writeFile(filesArchivePath, "archive-content-is-streamed");
  await fs.promises.writeFile(manifestPath, JSON.stringify({ backupId }));
  return {
    backup: {
      id: backupId,
      siteId: "site-1",
      status: "success",
      backupType: "full",
      startedAt: new Date(),
      completedAt: new Date(),
      totalBytes: null,
      dbDumpPath,
      filesArchivePath,
      manifestPath
    },
    site: { id: "site-1", name: "Example / Site", slug: "example-site" }
  };
}

function transientError() {
  return Object.assign(new Error("service unavailable"), { response: { status: 503 } });
}

describe("GoogleDriveProvider integration with mocked Drive API", () => {
  test("creates the default hierarchy once, streams artifacts, verifies them, and persists IDs", async () => {
    const client = new MockGoogleDriveClient();
    const metadata = new MemoryMetadataRepository();
    const uploadedArtifactKinds: RemoteFileKind[] = [];
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: metadata,
      installationName: "Test Machine",
      sleep: async () => {},
      onArtifactUploaded: (artifact) => {
        uploadedArtifactKinds.push(artifact.artifactKind);
      }
    });
    const progress: number[] = [];
    const first = await provider.uploadBackup(await backupSource("backup-1"), (event) => {
      progress.push(event.percent ?? 0);
    });
    const second = await provider.uploadBackup(await backupSource("backup-2"));

    assert.equal(client.createdFolderCount, 3);
    assert.equal(first.files.length, 3);
    assert.deepEqual(first.files.map((file) => file.kind), ["database", "files", "manifest"]);
    assert.deepEqual(uploadedArtifactKinds.slice(0, 3), ["database", "files", "manifest"]);
    assert.equal(second.files.length, 3);
    assert.equal(progress.some((value) => value > 0), true);
    assert.equal(progress.at(-1), 100);
    const records = await metadata.findForBackup("connection-1", "backup-1");
    assert.equal(records.length, 3);
    assert.equal(records.every((record) => record.uploadStatus === "success"), true);
    assert.equal(records.every((record) => Boolean(record.remoteFileId && record.remoteFolderId)), true);
    assert.equal(records.every((record) => record.remoteSize === record.localSize), true);
    assert.equal(records.every((record) => record.localChecksum === record.remoteChecksum), true);
    assert.equal(records.every((record) => Boolean(record.verifiedAt)), true);
  });

  test("never treats a full backup without its files archive as uploadable", async () => {
    const client = new MockGoogleDriveClient();
    const source = await backupSource("backup-missing-files");
    source.backup.filesArchivePath = null;
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: new MemoryMetadataRepository(),
      installationName: "Test Machine",
      sleep: async () => {}
    });

    await assert.rejects(
      provider.uploadBackup(source),
      /full backup is missing required files artifact/
    );
    assert.equal(client.uploadAttempts, 0);
  });

  test("retries transient API failures and does not retry permanent authentication errors", async () => {
    const transientClient = new MockGoogleDriveClient();
    transientClient.uploadErrors.push(transientError());
    const transientProvider = new GoogleDriveProvider(context, {
      clientFactory: async () => transientClient,
      metadataRepository: new MemoryMetadataRepository(),
      installationName: "Test Machine",
      sleep: async () => {}
    });
    await transientProvider.uploadBackup(await backupSource("backup-retry"));
    assert.equal(transientClient.uploadAttempts, 4);

    const permanentClient = new MockGoogleDriveClient();
    permanentClient.uploadErrors.push(
      Object.assign(new Error("invalid credentials"), { response: { status: 401 } })
    );
    const metadata = new MemoryMetadataRepository();
    const source = await backupSource("backup-auth-failure");
    const permanentProvider = new GoogleDriveProvider(context, {
      clientFactory: async () => permanentClient,
      metadataRepository: metadata,
      installationName: "Test Machine",
      sleep: async () => {}
    });

    await assert.rejects(
      permanentProvider.uploadBackup(source),
      (error: unknown) => error instanceof CloudProviderError && error.code === "authentication_failed"
    );
    assert.equal(permanentClient.uploadAttempts, 1);
    assert.equal(fs.existsSync(source.backup.dbDumpPath!), true);
    const failed = await metadata.findForBackup("connection-1", source.backup.id);
    assert.equal(failed[0]?.uploadStatus, "failed");
  });

  test("lists, verifies, downloads, and deletes remote files independently of local files", async () => {
    const client = new MockGoogleDriveClient();
    const metadata = new MemoryMetadataRepository();
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: metadata,
      installationName: "Test Machine",
      sleep: async () => {}
    });
    const source = await backupSource("backup-lifecycle");
    const remote = await provider.uploadBackup(source);

    assert.equal(await provider.verifyBackupExists({ remoteBackup: remote }), true);
    const listed = await provider.listRemoteBackups({ siteId: source.site.id });
    assert.equal(listed.backups[0]?.backupId, source.backup.id);

    const downloadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stackpress-download-test-"));
    tempDirectories.push(downloadRoot);
    const downloaded = await provider.downloadBackup({
      remoteBackup: remote,
      destinationDirectory: downloadRoot
    });
    assert.equal(fs.existsSync(downloaded.filesArchivePath!), true);

    await provider.deleteBackup({ remoteBackup: remote });
    assert.equal(client.deletedIds.length, 3);
    assert.equal(fs.existsSync(source.backup.filesArchivePath!), true);
    assert.equal(await provider.verifyBackupExists({ remoteBackup: remote }), false);
    const records = await metadata.findForBackup("connection-1", source.backup.id);
    assert.equal(records.every((record) => record.uploadStatus === "deleted"), true);
  });

  test("retries interrupted streaming downloads, removes partial files, and verifies checksums", async () => {
    const client = new MockGoogleDriveClient();
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: new MemoryMetadataRepository(),
      installationName: "Test Machine",
      sleep: async () => {}
    });
    const remote = await provider.uploadBackup(await backupSource("backup-interrupted-download"));
    client.downloadErrors.push(transientError());
    const downloaded = await provider.downloadBackup({ remoteBackup: remote, destinationDirectory: "" });
    tempDirectories.push(downloaded.destinationDirectory);
    assert.equal(client.downloadAttempts, remote.files.length + 1);
    assert.equal(fs.existsSync(downloaded.filesArchivePath!), true);
    assert.deepEqual((await fs.promises.readdir(downloaded.destinationDirectory)).filter((name) => name.endsWith(".partial")), []);
  });

  test("rejects checksum mismatches, cleans controlled temporary files, and never overwrites unrelated files", async () => {
    const client = new MockGoogleDriveClient();
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: new MemoryMetadataRepository(),
      installationName: "Test Machine",
      sleep: async () => {}
    });
    const remote = await provider.uploadBackup(await backupSource("backup-bad-download"));
    const corrupted = { ...remote, files: remote.files.map((file, index) => index === 0 ? { ...file, checksum: "0".repeat(64), checksumAlgorithm: "sha256" } : file) };
    await assert.rejects(provider.downloadBackup({ remoteBackup: corrupted, destinationDirectory: "" }), (error: unknown) => error instanceof CloudProviderError && error.code === "verification_failed");

    const destination = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stackpress-no-overwrite-"));
    tempDirectories.push(destination);
    const protectedPath = path.join(destination, `database-${remote.files.find((file) => file.kind === "database")!.name}`);
    await fs.promises.writeFile(protectedPath, "unrelated-file");
    await assert.rejects(provider.downloadBackup({ remoteBackup: remote, destinationDirectory: destination }), /Refusing to overwrite/);
    assert.equal(await fs.promises.readFile(protectedPath, "utf8"), "unrelated-file");
  });

  test("does not retry revoked Google authorization during download", async () => {
    const client = new MockGoogleDriveClient();
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: new MemoryMetadataRepository(),
      installationName: "Test Machine",
      sleep: async () => {}
    });
    const remote = await provider.uploadBackup(await backupSource("backup-revoked-download"));
    client.downloadErrors.push(Object.assign(new Error("revoked"), { response: { status: 401 } }));
    await assert.rejects(provider.downloadBackup({ remoteBackup: remote, destinationDirectory: "" }), (error: unknown) => error instanceof CloudProviderError && error.code === "authentication_failed");
    assert.equal(client.downloadAttempts, 1);
  });

  test("refuses to delete a stored Drive ID when the remote file is not StackPress-managed", async () => {
    const client = new MockGoogleDriveClient();
    const metadata = new MemoryMetadataRepository();
    const provider = new GoogleDriveProvider(context, {
      clientFactory: async () => client,
      metadataRepository: metadata,
      installationName: "Test Machine",
      sleep: async () => {}
    });
    const remote = await provider.uploadBackup(await backupSource("backup-unmanaged-delete"));
    const target = client.files.get(remote.files[0].remoteId)!;
    client.files.set(target.id, { ...target, appProperties: { ...target.appProperties, stackpressManaged: "false" } });
    await assert.rejects(provider.deleteBackup({ remoteBackup: remote }), /Refusing to delete/);
    assert.equal(client.deletedIds.length, 0);
    const records = await metadata.findForBackup("connection-1", "backup-unmanaged-delete");
    assert.equal(records[0].deletionStatus, "failed");
  });
});
