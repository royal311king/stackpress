-- Additive migration: existing Site and BackupJob rows are not modified.
CREATE TABLE "CloudStorageConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountEmail" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "encryptedCredentials" TEXT,
    "credentialReference" TEXT,
    "credentialKeyVersion" INTEGER,
    "providerConfigJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastConnectedAt" DATETIME,
    "lastTestedAt" DATETIME,
    "lastError" TEXT
);

CREATE INDEX "CloudStorageConnection_provider_enabled_idx"
ON "CloudStorageConnection"("provider", "enabled");

CREATE INDEX "CloudStorageConnection_status_updatedAt_idx"
ON "CloudStorageConnection"("status", "updatedAt");
