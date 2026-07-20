import type {
  CloudBackupSource,
  ConnectionTestResult,
  DeleteBackupRequest,
  DownloadBackupRequest,
  DownloadedBackupResult,
  ListRemoteBackupsRequest,
  ListRemoteBackupsResult,
  RemoteBackupResult,
  UploadProgressHandler,
  VerifyBackupRequest
} from "./types";

/**
 * A cloud replica destination. Implementations copy completed StackPress local
 * artifacts; they do not create backups or change local backup state.
 */
export interface CloudStorageProvider {
  testConnection(): Promise<ConnectionTestResult>;

  uploadBackup(
    source: CloudBackupSource,
    onProgress?: UploadProgressHandler
  ): Promise<RemoteBackupResult>;

  downloadBackup(request: DownloadBackupRequest): Promise<DownloadedBackupResult>;

  deleteBackup(request: DeleteBackupRequest): Promise<void>;

  verifyBackupExists(request: VerifyBackupRequest): Promise<boolean>;

  listRemoteBackups(
    request?: ListRemoteBackupsRequest
  ): Promise<ListRemoteBackupsResult>;
}
