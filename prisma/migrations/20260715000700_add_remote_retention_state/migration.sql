ALTER TABLE "BackupJob" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteCloudDestination" ADD COLUMN "retentionPolicy" TEXT NOT NULL DEFAULT 'retain_remote';
ALTER TABLE "CloudBackupFile" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "CloudBackupFile" ADD COLUMN "deletionStatus" TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE "CloudBackupFile" ADD COLUMN "deletionAttemptedAt" DATETIME;
ALTER TABLE "CloudBackupFile" ADD COLUMN "deletedAt" DATETIME;
