-- Remote metadata only. No local BackupJob rows or backup files are changed.
CREATE TABLE "CloudBackupFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cloudConnectionId" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "artifactKind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "remoteFileId" TEXT,
    "remoteFolderId" TEXT,
    "remoteName" TEXT NOT NULL,
    "remoteSize" BIGINT,
    "localSize" BIGINT,
    "localChecksum" TEXT,
    "remoteChecksum" TEXT,
    "checksumAlgorithm" TEXT,
    "uploadStatus" TEXT NOT NULL DEFAULT 'pending',
    "uploadedAt" DATETIME,
    "verifiedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CloudBackupFile_cloudConnectionId_backupId_artifactKind_key"
ON "CloudBackupFile"("cloudConnectionId", "backupId", "artifactKind");

CREATE INDEX "CloudBackupFile_backupId_cloudConnectionId_idx"
ON "CloudBackupFile"("backupId", "cloudConnectionId");

CREATE INDEX "CloudBackupFile_uploadStatus_updatedAt_idx"
ON "CloudBackupFile"("uploadStatus", "updatedAt");

CREATE INDEX "CloudBackupFile_provider_remoteFileId_idx"
ON "CloudBackupFile"("provider", "remoteFileId");
