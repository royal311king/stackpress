ALTER TABLE "CloudUploadJob" ADD COLUMN "destinationConfigJson" TEXT NOT NULL DEFAULT '{}';

CREATE TABLE "SiteCloudDestination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "cloudConnectionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "uploadScheduledBackups" BOOLEAN NOT NULL DEFAULT true,
    "uploadManualBackups" BOOLEAN NOT NULL DEFAULT true,
    "remoteFolderName" TEXT,
    "providerConfigJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SiteCloudDestination_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SiteCloudDestination_cloudConnectionId_fkey" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudStorageConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SiteCloudDestination_siteId_cloudConnectionId_key"
ON "SiteCloudDestination"("siteId", "cloudConnectionId");

CREATE INDEX "SiteCloudDestination_cloudConnectionId_enabled_idx"
ON "SiteCloudDestination"("cloudConnectionId", "enabled");
