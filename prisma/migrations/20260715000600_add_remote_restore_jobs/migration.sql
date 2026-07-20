CREATE TABLE "RemoteRestoreJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backupId" TEXT NOT NULL,
    "cloudConnectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "RemoteRestoreJob_backupId_cloudConnectionId_key" ON "RemoteRestoreJob"("backupId", "cloudConnectionId");
CREATE INDEX "RemoteRestoreJob_status_createdAt_idx" ON "RemoteRestoreJob"("status", "createdAt");
