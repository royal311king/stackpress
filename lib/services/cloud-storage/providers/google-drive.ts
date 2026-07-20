import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";

import type { CloudStorageProvider } from "../provider";
import {
  assertCloudUploadEligibleBackup,
  CloudProviderError,
  type CloudBackupSource,
  type CloudProviderContext,
  type ConnectionTestResult,
  type DeleteBackupRequest,
  type DownloadBackupRequest,
  type DownloadedBackupResult,
  type ListRemoteBackupsRequest,
  type ListRemoteBackupsResult,
  type RemoteBackupResult,
  type RemoteFileKind,
  type RemoteFileMetadata,
  type UploadProgressHandler,
  type VerifyBackupRequest
} from "../types";
import {
  prismaCloudBackupFileRepository,
  type CloudBackupFileRepository
} from "../cloud-backup-files";
import {
  createOfficialGoogleDriveClient,
  type GoogleDriveClient,
  type GoogleDriveFile
} from "../google-drive-client";

type GoogleDriveProviderOptions = {
  clientFactory?: (connectionId: string) => Promise<GoogleDriveClient>;
  metadataRepository?: CloudBackupFileRepository;
  installationName?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
};

type LocalArtifact = {
  kind: RemoteFileKind;
  localPath: string;
  name: string;
  size: number;
  md5: string;
  sha256: string;
};

type ErrorDetails = {
  status?: number;
  code?: string;
  reason?: string;
  retryAfterMs?: number;
};

function cleanFolderName(value: string) {
  return value.replace(/[\\/]/g, "-").trim() || "Unnamed";
}

function errorDetails(error: unknown): ErrorDetails {
  const candidate = error as {
    code?: string | number;
    response?: {
      status?: number;
      headers?: { get?: (name: string) => string | null; "retry-after"?: string };
      data?: { error?: { errors?: Array<{ reason?: string }> } };
    };
  };
  const retryAfter = candidate.response?.headers?.get?.("retry-after") ??
    candidate.response?.headers?.["retry-after"];
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  return {
    status: candidate.response?.status,
    code: candidate.code ? String(candidate.code) : undefined,
    reason: candidate.response?.data?.error?.errors?.[0]?.reason,
    retryAfterMs: Number.isFinite(retryAfterSeconds) ? Math.max(0, retryAfterSeconds * 1000) : undefined
  };
}

function providerError(operation: string, error: unknown) {
  if (error instanceof CloudProviderError) return error;
  const details = errorDetails(error);
  const transientReasons = new Set([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "backendError"
  ]);
  const transientCodes = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"]);
  const retryable =
    details.status === 408 ||
    details.status === 429 ||
    Boolean(details.status && details.status >= 500) ||
    Boolean(details.reason && transientReasons.has(details.reason)) ||
    Boolean(details.code && transientCodes.has(details.code));
  const authenticationFailure = details.status === 401;
  const permissionFailure = details.status === 403 && !retryable;
  const quotaFailure = ["storageQuotaExceeded", "quotaExceeded"].includes(details.reason ?? "");
  const rateLimited = details.status === 429 || Boolean(details.reason && transientReasons.has(details.reason));
  return new CloudProviderError({
    providerType: "google_drive",
    code: authenticationFailure
      ? "authentication_failed"
      : quotaFailure
        ? "quota_exceeded"
      : rateLimited
        ? "rate_limited"
      : permissionFailure
        ? "authorization_failed"
        : details.status === 404
          ? "not_found"
          : operation === "upload"
            ? "upload_failed"
            : operation === "download"
              ? "download_failed"
          : operation === "delete"
                ? "delete_failed"
                : operation === "verification"
                  ? "verification_failed"
                : "connection_failed",
    message: authenticationFailure
      ? "Google Drive authorization expired or was revoked. Reconnect the account."
      : quotaFailure
        ? "The Google Drive account does not have enough storage quota for this operation."
      : permissionFailure
        ? "Google Drive denied permission for this operation."
        : `Google Drive ${operation} failed${retryable ? " and will be retried" : ""}.`,
    retryable,
    details: {
      status: details.status,
      reason: details.reason,
      networkCode: details.code,
      retryAfterMs: details.retryAfterMs
    }
  });
}

async function checksums(localPath: string) {
  const md5 = createHash("md5");
  const sha256 = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(localPath);
    stream.on("data", (chunk) => {
      md5.update(chunk);
      sha256.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { md5: md5.digest("hex"), sha256: sha256.digest("hex") };
}

async function localArtifacts(source: CloudBackupSource): Promise<LocalArtifact[]> {
  const values: Array<{ kind: RemoteFileKind; localPath: string | null }> = [
    { kind: "database", localPath: source.backup.dbDumpPath },
    { kind: "files", localPath: source.backup.filesArchivePath },
    { kind: "manifest", localPath: source.backup.manifestPath }
  ];
  const artifacts: LocalArtifact[] = [];
  for (const value of values) {
    if (!value.localPath) continue;
    const stat = await fs.promises.stat(value.localPath);
    if (!stat.isFile()) throw new Error(`Local backup artifact is not a file: ${value.localPath}`);
    artifacts.push({
      kind: value.kind,
      localPath: value.localPath,
      name: path.basename(value.localPath),
      size: stat.size,
      ...(await checksums(value.localPath))
    });
  }
  if (artifacts.length === 0) throw new Error("Completed backup has no local artifacts to upload");
  return artifacts;
}

function compatibleChecksum(local: LocalArtifact, remote: GoogleDriveFile) {
  if (remote.sha256Checksum) {
    return { algorithm: "sha256", local: local.sha256, remote: remote.sha256Checksum };
  }
  if (remote.md5Checksum) {
    return { algorithm: "md5", local: local.md5, remote: remote.md5Checksum };
  }
  return null;
}

function verifyFile(local: LocalArtifact, remote: GoogleDriveFile) {
  if (remote.trashed) throw new Error("Uploaded Google Drive file is in the trash");
  if (remote.size === null || remote.size !== local.size) {
    throw new Error(`Google Drive size mismatch for ${local.name}`);
  }
  const checksum = compatibleChecksum(local, remote);
  if (checksum && checksum.local.toLowerCase() !== checksum.remote.toLowerCase()) {
    throw new Error(`Google Drive ${checksum.algorithm} checksum mismatch for ${local.name}`);
  }
  return checksum;
}

function remoteMetadata(kind: RemoteFileKind, file: GoogleDriveFile): RemoteFileMetadata {
  const checksum = file.sha256Checksum
    ? { value: file.sha256Checksum, algorithm: "sha256" }
    : file.md5Checksum
      ? { value: file.md5Checksum, algorithm: "md5" }
      : null;
  return {
    kind,
    remoteId: file.id,
    name: file.name,
    remotePath: null,
    sizeBytes: file.size,
    checksum: checksum?.value ?? null,
    checksumAlgorithm: checksum?.algorithm ?? null,
    contentType: "application/octet-stream",
    webUrl: file.webViewLink,
    createdAt: file.createdTime,
    metadata: { parents: file.parents, appProperties: file.appProperties }
  };
}

export class GoogleDriveProvider implements CloudStorageProvider {
  private readonly clientFactory: (connectionId: string) => Promise<GoogleDriveClient>;
  private readonly metadata: CloudBackupFileRepository;
  private readonly installationName: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;

  constructor(
    private readonly context: CloudProviderContext,
    options: GoogleDriveProviderOptions = {}
  ) {
    this.clientFactory = options.clientFactory ?? createOfficialGoogleDriveClient;
    this.metadata = options.metadataRepository ?? prismaCloudBackupFileRepository;
    this.installationName = cleanFolderName(
      options.installationName ||
      String(context.connection.config.installationName || process.env.STACKPRESS_INSTALLATION_NAME || os.hostname())
    );
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.maxAttempts = options.maxAttempts ?? 4;
  }

  private client() {
    return this.clientFactory(this.context.connection.id);
  }

  private async retry<T>(operation: string, run: () => Promise<T>) {
    let lastError: CloudProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        lastError = providerError(operation, error);
        if (!lastError.retryable || attempt === this.maxAttempts) throw lastError;
        const retryAfterMs = Number(lastError.details?.retryAfterMs);
        const exponentialMs = Math.min(1000 * 2 ** (attempt - 1), 32_000);
        const jitteredMs = Math.round(exponentialMs * (0.5 + this.random() * 0.5));
        await this.sleep(Number.isFinite(retryAfterMs) ? Math.max(retryAfterMs, jitteredMs) : jitteredMs);
      }
    }
    throw lastError ?? providerError(operation, new Error("Unknown Google Drive failure"));
  }

  private async folder(
    client: GoogleDriveClient,
    name: string,
    parentId: string | undefined,
    kind: string
  ) {
    const existing = await this.retry("folder lookup", () => client.findFolder(name, parentId));
    if (existing) return existing;
    return this.retry("folder creation", () => client.createFolder(name, parentId, {
      stackpressManaged: "true",
      stackpressKind: kind
    }));
  }

  private async destinationFolder(client: GoogleDriveClient, source: CloudBackupSource) {
    const rootName = cleanFolderName(String(this.context.connection.config.rootFolderName || "StackPress Backups"));
    const root = await this.folder(client, rootName, undefined, "root");
    const installation = await this.folder(client, this.installationName, root.id, "installation");
    const siteFolderName = String(this.context.connection.config.siteFolderName || source.site.name);
    return this.folder(client, cleanFolderName(siteFolderName), installation.id, "site");
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const result = await this.retry("connection test", async () => (await this.client()).testConnection());
      return {
        ok: true,
        message: "Connected to Google Drive",
        checkedAt: new Date().toISOString(),
        accountLabel: result.accountEmail
      };
    } catch (error) {
      throw providerError("connection test", error);
    }
  }

  async uploadBackup(
    source: CloudBackupSource,
    onProgress?: UploadProgressHandler
  ): Promise<RemoteBackupResult> {
    assertCloudUploadEligibleBackup(source.backup, "google_drive");
    const artifacts = await localArtifacts(source);
    const totalBytes = artifacts.reduce((total, artifact) => total + artifact.size, 0);
    let completedBytes = 0;
    const client = await this.client();
    const destination = await this.destinationFolder(client, source);
    const remoteFiles: RemoteFileMetadata[] = [];

    for (const artifact of artifacts) {
      let record = await this.metadata.findByKey({
        cloudConnectionId: this.context.connection.id,
        backupId: source.backup.id,
        artifactKind: artifact.kind
      });
      if (!record) {
        record = await this.metadata.upsertPending({
          cloudConnectionId: this.context.connection.id,
          backupId: source.backup.id,
          siteId: source.site.id,
          artifactKind: artifact.kind,
          provider: "google_drive",
          remoteName: artifact.name,
          localSize: BigInt(artifact.size),
          localChecksum: artifact.sha256,
          checksumAlgorithm: "sha256"
        });
      }

      try {
        await this.metadata.update(record.id, {
          uploadStatus: "uploading",
          remoteFolderId: destination.id,
          lastError: null
        });
        let remote = record.remoteFileId
          ? await this.retry("verification", () => client.getFile(record!.remoteFileId!))
          : null;
        if (!remote) {
          remote = await this.retry("lookup", () =>
            client.findManagedBackupFile(source.backup.id, artifact.kind, destination.id)
          );
        }
        if (!remote) {
          remote = await this.retry("upload", async () => {
            const completedOnPriorAttempt = await client.findManagedBackupFile(
              source.backup.id,
              artifact.kind,
              destination.id
            );
            if (completedOnPriorAttempt) return completedOnPriorAttempt;
            return client.uploadFile({
              name: artifact.name,
              parentId: destination.id,
              localPath: artifact.localPath,
              mimeType: artifact.kind === "manifest" ? "application/json" : "application/octet-stream",
              appProperties: {
                stackpressManaged: "true",
                stackpressBackupId: source.backup.id,
                stackpressSiteId: source.site.id,
                stackpressSiteSlug: source.site.slug,
                stackpressArtifactKind: artifact.kind
              },
              onProgress: (currentFileBytesUploaded) => {
                const totalBytesUploaded = completedBytes + currentFileBytesUploaded;
                void Promise.resolve(onProgress?.({
                  backupId: source.backup.id,
                  currentFile: artifact.kind,
                  currentFileBytesUploaded,
                  currentFileTotalBytes: artifact.size,
                  totalBytesUploaded,
                  totalBytes,
                  percent: totalBytes > 0 ? Math.min(100, (totalBytesUploaded / totalBytes) * 100) : 100
                })).catch(() => {});
              }
            });
          });
        }

        const verified = await this.retry("verification", async () => {
          const value = await client.getFile(remote!.id);
          if (!value) throw new Error("Uploaded Google Drive file no longer exists");
          verifyFile(artifact, value);
          return value;
        });
        const checksum = compatibleChecksum(artifact, verified);
        const now = new Date();
        await this.metadata.update(record.id, {
          remoteFileId: verified.id,
          remoteFolderId: destination.id,
          remoteName: verified.name,
          remoteSize: verified.size === null ? null : BigInt(verified.size),
          localChecksum: checksum?.local ?? artifact.sha256,
          remoteChecksum: checksum?.remote ?? null,
          checksumAlgorithm: checksum?.algorithm ?? "sha256",
          uploadStatus: "success",
          verificationStatus: "verified",
          deletionStatus: "not_requested",
          deletionAttemptedAt: null,
          deletedAt: null,
          uploadedAt: now,
          verifiedAt: now,
          lastError: null
        });
        completedBytes += artifact.size;
        remoteFiles.push(remoteMetadata(artifact.kind, verified));
      } catch (error) {
        const normalized = providerError("upload", error);
        await this.metadata.update(record.id, {
          uploadStatus: "failed",
          lastError: normalized.message
        });
        throw normalized;
      }
    }

    return {
      backupId: source.backup.id,
      siteId: source.site.id,
      connectionId: this.context.connection.id,
      providerType: "google_drive",
      remotePrefix: destination.id,
      files: remoteFiles,
      uploadedAt: new Date().toISOString(),
      metadata: { installationName: this.installationName }
    };
  }

  async downloadBackup(request: DownloadBackupRequest): Promise<DownloadedBackupResult> {
    const client = await this.client();
    const ownsDestination = !request.destinationDirectory.trim();
    const destinationDirectory = ownsDestination
      ? await fs.promises.mkdtemp(path.join(os.tmpdir(), "stackpress-restore-"))
      : request.destinationDirectory;
    await fs.promises.mkdir(destinationDirectory, { recursive: true });
    const paths: Partial<Record<RemoteFileKind, string>> = {};

    try {
      const expectedBytes = request.remoteBackup.files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0);
      const disk = await fs.promises.statfs(destinationDirectory);
      if (Number(disk.bavail) * Number(disk.bsize) < expectedBytes + 64 * 1024 * 1024) {
        throw new CloudProviderError({ providerType: "google_drive", code: "download_failed", message: "Insufficient temporary disk space for the Google Drive restore download" });
      }

      let completedBytes = 0;
      for (const file of request.remoteBackup.files) {
        const safeName = `${file.kind}-${path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const destinationPath = path.join(destinationDirectory, safeName);
        const partialPath = path.join(destinationDirectory, `.${safeName}.${randomUUID()}.partial`);
        if (fs.existsSync(destinationPath)) {
          throw new CloudProviderError({ providerType: "google_drive", code: "conflict", message: `Refusing to overwrite existing file: ${safeName}` });
        }
        await this.retry("download", async () => {
          await fs.promises.rm(partialPath, { force: true });
          try {
            await client.downloadFile(file.remoteId, partialPath, (currentFileBytes) => {
              void Promise.resolve(request.onProgress?.(
                completedBytes + currentFileBytes,
                expectedBytes || null
              )).catch(() => {});
            });
          } catch (error) {
            await fs.promises.rm(partialPath, { force: true }).catch(() => {});
            throw error;
          }
        });
        const stat = await fs.promises.stat(partialPath);
        if (file.sizeBytes !== null && stat.size !== file.sizeBytes) {
          throw new CloudProviderError({ providerType: "google_drive", code: "verification_failed", message: `Downloaded Google Drive file size does not match: ${file.name}` });
        }
        if (file.checksum && (file.checksumAlgorithm === "md5" || file.checksumAlgorithm === "sha256")) {
          const digest = await new Promise<string>((resolve, reject) => {
            const hash = createHash(file.checksumAlgorithm!);
            const stream = fs.createReadStream(partialPath);
            stream.on("error", reject);
            stream.on("data", (chunk) => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
          });
          if (digest.toLowerCase() !== file.checksum.toLowerCase()) {
            throw new CloudProviderError({ providerType: "google_drive", code: "verification_failed", message: `Downloaded Google Drive checksum does not match: ${file.name}` });
          }
        }
        await fs.promises.link(partialPath, destinationPath);
        await fs.promises.unlink(partialPath);
        paths[file.kind] = destinationPath;
        completedBytes += stat.size;
      }

      return { backupId: request.remoteBackup.backupId, destinationDirectory, dbDumpPath: paths.database ?? null, filesArchivePath: paths.files ?? null, manifestPath: paths.manifest ?? null };
    } catch (error) {
      if (ownsDestination) await fs.promises.rm(destinationDirectory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async deleteBackup(request: DeleteBackupRequest): Promise<void> {
    const client = await this.client();
    for (const file of request.remoteBackup.files) {
      const record = await this.metadata.findByKey({
        cloudConnectionId: request.remoteBackup.connectionId,
        backupId: request.remoteBackup.backupId,
        artifactKind: file.kind
      });
      if (!record?.remoteFileId || record.remoteFileId !== file.remoteId) {
        throw new CloudProviderError({ providerType: "google_drive", code: "conflict", message: "Remote deletion requires a matching stored provider file ID" });
      }
      try {
        const remote = await this.retry("verification", () => client.getFile(record.remoteFileId!));
        if (!remote || remote.appProperties.stackpressManaged !== "true" || remote.appProperties.stackpressBackupId !== request.remoteBackup.backupId || remote.appProperties.stackpressArtifactKind !== file.kind) {
          throw new CloudProviderError({ providerType: "google_drive", code: "authorization_failed", message: "Refusing to delete a Google Drive file not created for this StackPress backup" });
        }
        await this.retry("delete", () => client.deleteFile(record.remoteFileId!));
        await this.metadata.update(record.id, {
          uploadStatus: "deleted",
          deletionStatus: "deleted",
          deletionAttemptedAt: new Date(),
          deletedAt: new Date(),
          lastError: null
        });
      } catch (error) {
        await this.metadata.update(record.id, { deletionStatus: "failed", deletionAttemptedAt: new Date(), lastError: error instanceof Error ? error.message : "Remote deletion failed" });
        throw error;
      }
    }
  }

  async verifyBackupExists(request: VerifyBackupRequest): Promise<boolean> {
    const client = await this.client();
    for (const file of request.remoteBackup.files) {
      const remote = await this.retry("verification", () => client.getFile(file.remoteId));
      if (!remote || remote.trashed) return false;
      if (file.sizeBytes !== null && remote.size !== file.sizeBytes) return false;
      if (file.checksum && file.checksumAlgorithm === "sha256" && remote.sha256Checksum) {
        if (file.checksum.toLowerCase() !== remote.sha256Checksum.toLowerCase()) return false;
      }
      if (file.checksum && file.checksumAlgorithm === "md5" && remote.md5Checksum) {
        if (file.checksum.toLowerCase() !== remote.md5Checksum.toLowerCase()) return false;
      }
    }
    return true;
  }

  async listRemoteBackups(
    request: ListRemoteBackupsRequest = {}
  ): Promise<ListRemoteBackupsResult> {
    const client = await this.client();
    const result = await this.retry("list", () => client.listManagedFiles({
      siteId: request.siteId,
      pageToken: request.cursor,
      pageSize: request.limit
    }));
    const grouped = new Map<string, { siteId: string; files: RemoteFileMetadata[] }>();
    for (const file of result.files) {
      const backupId = file.appProperties.stackpressBackupId;
      const siteId = file.appProperties.stackpressSiteId;
      const artifactKind = file.appProperties.stackpressArtifactKind as RemoteFileKind | undefined;
      if (!backupId || !siteId || !artifactKind) continue;
      const group = grouped.get(backupId) ?? { siteId, files: [] };
      group.files.push(remoteMetadata(artifactKind, file));
      grouped.set(backupId, group);
    }
    return {
      backups: [...grouped.entries()].map(([backupId, group]) => ({
        backupId,
        siteId: group.siteId,
        connectionId: this.context.connection.id,
        providerType: "google_drive" as const,
        remotePrefix: group.files[0]?.metadata?.parents instanceof Array
          ? String(group.files[0].metadata.parents[0] ?? "")
          : null,
        files: group.files,
        uploadedAt: group.files.map((file) => file.createdAt).filter(Boolean).sort().at(-1) ?? null
      })),
      nextCursor: result.nextPageToken
    };
  }
}
