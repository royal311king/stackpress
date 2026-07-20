import type { BackupJob, Site } from "@prisma/client";

export const CLOUD_PROVIDER_TYPES = [
  "google_drive",
  "dropbox",
  "s3",
  "backblaze_b2",
  "cloudflare_r2",
  "onedrive",
  "smb",
  "sftp"
] as const;

export type CloudProviderType = (typeof CLOUD_PROVIDER_TYPES)[number];

/**
 * Provider configuration is safe to persist and display. Credentials are
 * supplied separately so callers do not accidentally serialize secrets.
 */
export type CloudConnection = {
  id: string;
  name: string;
  providerType: CloudProviderType;
  enabled: boolean;
  config: Readonly<Record<string, unknown>>;
};

/** Decrypted, server-only credentials supplied when constructing a provider. */
export type CloudCredentials = Readonly<Record<string, unknown>>;

export type CloudProviderContext = {
  connection: CloudConnection;
  credentials: CloudCredentials;
};

type LocalBackupRecordBase = Pick<
  BackupJob,
  | "id"
  | "siteId"
  | "status"
  | "backupType"
  | "startedAt"
  | "completedAt"
  | "totalBytes"
  | "dbDumpPath"
  | "filesArchivePath"
  | "manifestPath"
>;

export const CLOUD_UPLOAD_ELIGIBLE_BACKUP_STATUSES = [
  "success",
  "success_with_warnings",
  "completed"
] as const;

export type CloudUploadEligibleBackupStatus =
  (typeof CLOUD_UPLOAD_ELIGIBLE_BACKUP_STATUSES)[number];

export type LocalBackupRecord = Omit<LocalBackupRecordBase, "status"> & {
  status: CloudUploadEligibleBackupStatus;
};

export function isCloudUploadEligibleBackup(
  backup: Pick<BackupJob, "status">
): backup is Pick<BackupJob, "status"> & { status: CloudUploadEligibleBackupStatus } {
  return CLOUD_UPLOAD_ELIGIBLE_BACKUP_STATUSES.includes(
    backup.status as CloudUploadEligibleBackupStatus
  );
}

export function assertCloudUploadEligibleBackup(
  backup: Pick<BackupJob, "id" | "status">,
  providerType: CloudProviderType
): asserts backup is Pick<BackupJob, "id" | "status"> & {
  status: CloudUploadEligibleBackupStatus;
} {
  if (!isCloudUploadEligibleBackup(backup)) {
    throw new CloudProviderError({
      providerType,
      code: "conflict",
      message: `Backup ${backup.id} is not complete and cannot be uploaded`
    });
  }
}

export type BackupSiteReference = Pick<Site, "id" | "name" | "slug">;

export type CloudBackupSource = {
  backup: LocalBackupRecord;
  site: BackupSiteReference;
};

export type RemoteFileKind = "database" | "files" | "manifest";

export function requiredBackupArtifactKinds(backupType: string): RemoteFileKind[] {
  return backupType === "database"
    ? ["database"]
    : backupType === "files"
      ? ["files"]
      : ["database", "files"];
}

export type RemoteFileMetadata = {
  kind: RemoteFileKind;
  remoteId: string;
  name: string;
  remotePath: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  checksumAlgorithm: string | null;
  contentType: string | null;
  webUrl: string | null;
  createdAt: string | null;
  metadata?: Readonly<Record<string, unknown>>;
};

export type RemoteBackupResult = {
  backupId: string;
  siteId: string;
  connectionId: string;
  providerType: CloudProviderType;
  remotePrefix: string | null;
  files: readonly RemoteFileMetadata[];
  uploadedAt: string | null;
  metadata?: Readonly<Record<string, unknown>>;
};

export type UploadProgress = {
  backupId: string;
  currentFile: RemoteFileKind | null;
  currentFileBytesUploaded: number;
  currentFileTotalBytes: number | null;
  totalBytesUploaded: number;
  totalBytes: number | null;
  percent: number | null;
};

export type UploadProgressHandler = (progress: UploadProgress) => void | Promise<void>;

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  checkedAt: string;
  accountLabel?: string | null;
};

export type DownloadBackupRequest = {
  remoteBackup: RemoteBackupResult;
  destinationDirectory: string;
  onProgress?: (bytesDownloaded: number, totalBytes: number | null) => void | Promise<void>;
};

export type DownloadedBackupResult = {
  backupId: string;
  destinationDirectory: string;
  dbDumpPath: string | null;
  filesArchivePath: string | null;
  manifestPath: string | null;
};

export type DeleteBackupRequest = {
  remoteBackup: RemoteBackupResult;
};

export type VerifyBackupRequest = {
  remoteBackup: RemoteBackupResult;
};

export type ListRemoteBackupsRequest = {
  siteId?: string;
  siteSlug?: string;
  cursor?: string;
  limit?: number;
};

export type ListRemoteBackupsResult = {
  backups: readonly RemoteBackupResult[];
  nextCursor: string | null;
};

export type ProviderErrorCode =
  | "authentication_failed"
  | "authorization_failed"
  | "invalid_configuration"
  | "connection_failed"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "upload_failed"
  | "download_failed"
  | "delete_failed"
  | "verification_failed"
  | "unknown";

export class CloudProviderError extends Error {
  readonly providerType: CloudProviderType;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: {
    providerType: CloudProviderType;
    code: ProviderErrorCode;
    message: string;
    retryable?: boolean;
    details?: Readonly<Record<string, unknown>>;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "CloudProviderError";
    this.providerType = options.providerType;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
