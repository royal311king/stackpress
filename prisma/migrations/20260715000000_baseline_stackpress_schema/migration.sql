-- Baseline for the pre-cloud StackPress schema.
-- Existing installations created with `prisma db push` must mark this migration
-- as applied before running `prisma migrate deploy`; see README.md.
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "siteUrl" TEXT,
    "siteDirectory" TEXT,
    "backupDestination" TEXT,
    "customSiteDirectory" TEXT,
    "customBackupDestination" TEXT,
    "dbContainerName" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "dbUser" TEXT NOT NULL,
    "dbPassword" TEXT NOT NULL,
    "wordpressContainerName" TEXT NOT NULL,
    "uploadsPath" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "backupFrequency" TEXT NOT NULL DEFAULT 'manual',
    "backupTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "cronExpression" TEXT,
    "retentionCount" INTEGER NOT NULL DEFAULT 10,
    "retentionDays" INTEGER,
    "neverDeleteNewest" BOOLEAN NOT NULL DEFAULT true,
    "backupMode" TEXT NOT NULL DEFAULT 'full',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastBackupAt" DATETIME,
    "lastBackupStatus" TEXT,
    "lastBackupMessage" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "healthStatusCode" INTEGER,
    "healthResponseTimeMs" INTEGER,
    "healthCheckedAt" DATETIME,
    "healthError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "backupType" TEXT NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "durationSeconds" INTEGER,
    "totalBytes" BIGINT,
    "dbDumpPath" TEXT,
    "filesArchivePath" TEXT,
    "manifestPath" TEXT,
    "progressStep" TEXT,
    "errorMessage" TEXT,
    "logExcerpt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BackupJob_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "appName" TEXT NOT NULL DEFAULT 'StackPress',
    "appSubtitle" TEXT NOT NULL DEFAULT 'Self-Hosted WordPress Stack Manager',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "backupRoot" TEXT NOT NULL DEFAULT './storage',
    "sitesRoot" TEXT NOT NULL DEFAULT '/mnt/wp-sites',
    "defaultBackupRoot" TEXT DEFAULT './storage',
    "defaultLogRoot" TEXT DEFAULT './logs',
    "schedulerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "diskFreeThresholdGb" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL DEFAULT 'info',
    "scope" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
CREATE INDEX "Site_active_scheduleEnabled_idx" ON "Site"("active", "scheduleEnabled");
CREATE INDEX "BackupJob_siteId_createdAt_idx" ON "BackupJob"("siteId", "createdAt");
CREATE INDEX "BackupJob_status_createdAt_idx" ON "BackupJob"("status", "createdAt");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
