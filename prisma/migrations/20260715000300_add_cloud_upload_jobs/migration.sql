CREATE TABLE "CloudUploadJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backupId" TEXT NOT NULL,
    "cloudConnectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CloudUploadJob_backupId_cloudConnectionId_key"
ON "CloudUploadJob"("backupId", "cloudConnectionId");

CREATE INDEX "CloudUploadJob_status_nextAttemptAt_idx"
ON "CloudUploadJob"("status", "nextAttemptAt");

CREATE INDEX "CloudUploadJob_backupId_status_idx"
ON "CloudUploadJob"("backupId", "status");
