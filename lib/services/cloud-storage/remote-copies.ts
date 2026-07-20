import fs from "node:fs";

import { prisma } from "@/lib/prisma";
import { runRestore } from "@/lib/services/restore";
import { logActivity } from "@/lib/services/logging";
import { cloudConnectionService } from "./connections";
import { registerBuiltInCloudStorageProviders } from "./providers";
import { createCloudStorageProvider } from "./registry";
import type { RemoteBackupResult, RemoteFileKind } from "./types";

function asNumber(value: bigint | null) {
  return value === null ? null : Number(value);
}

export function safeGoogleDriveFolderUrl(folderId?: string | null) {
  return folderId && /^[A-Za-z0-9_-]+$/.test(folderId)
    ? `https://drive.google.com/drive/folders/${folderId}`
    : null;
}

export async function getRemoteBackup(backupId: string, cloudConnectionId: string): Promise<RemoteBackupResult> {
  const records = await prisma.cloudBackupFile.findMany({
    where: { backupId, cloudConnectionId, remoteFileId: { not: null }, uploadStatus: "success" },
    orderBy: { createdAt: "asc" }
  });
  if (!records.length) throw new Error("No completed remote copy exists for this destination");
  const first = records[0];
  return {
    backupId,
    siteId: first.siteId,
    connectionId: cloudConnectionId,
    providerType: first.provider as "google_drive",
    remotePrefix: first.remoteFolderId,
    files: records.map((record) => ({
      kind: record.artifactKind as RemoteFileKind,
      remoteId: record.remoteFileId!,
      name: record.remoteName,
      remotePath: null,
      sizeBytes: asNumber(record.remoteSize),
      checksum: record.remoteChecksum,
      checksumAlgorithm: record.checksumAlgorithm,
      contentType: record.artifactKind === "manifest" ? "application/json" : "application/octet-stream",
      webUrl: null,
      createdAt: record.uploadedAt?.toISOString() ?? null
    })),
    uploadedAt: records.map((record) => record.uploadedAt?.toISOString()).filter(Boolean).sort().at(-1) ?? null
  };
}

async function providerFor(connectionId: string) {
  registerBuiltInCloudStorageProviders();
  return createCloudStorageProvider(await cloudConnectionService.getProviderContext(connectionId));
}

export async function verifyRemoteCopy(backupId: string, connectionId: string) {
  const remoteBackup = await getRemoteBackup(backupId, connectionId);
  await prisma.cloudBackupFile.updateMany({ where: { backupId, cloudConnectionId: connectionId }, data: { verificationStatus: "verifying" } });
  try {
    const verified = await (await providerFor(connectionId)).verifyBackupExists({ remoteBackup });
    if (!verified) throw new Error("Remote copy could not be verified against its recorded metadata");
    await prisma.cloudBackupFile.updateMany({
      where: { backupId, cloudConnectionId: connectionId, uploadStatus: "success" },
      data: { verifiedAt: new Date(), verificationStatus: "verified", lastError: null }
    });
    return true;
  } catch (error) {
    await prisma.cloudBackupFile.updateMany({ where: { backupId, cloudConnectionId: connectionId }, data: { verificationStatus: "failed", lastError: error instanceof Error ? error.message : "Verification failed" } });
    throw error;
  }
}

export async function downloadRemoteCopy(
  backupId: string,
  connectionId: string,
  onProgress?: (bytesDownloaded: number, totalBytes: number | null) => void | Promise<void>
) {
  const remoteBackup = await getRemoteBackup(backupId, connectionId);
  return (await providerFor(connectionId)).downloadBackup({ remoteBackup, destinationDirectory: "", onProgress });
}

export async function deleteRemoteCopy(backupId: string, connectionId: string) {
  const remoteBackup = await getRemoteBackup(backupId, connectionId);
  await (await providerFor(connectionId)).deleteBackup({ remoteBackup });
  await prisma.cloudUploadJob.updateMany({
    where: { backupId, cloudConnectionId: connectionId },
    data: { status: "deleted", lastError: null }
  });
}

export async function restoreRemoteCopy(
  backupId: string,
  connectionId: string,
  onDownloadProgress?: (bytesDownloaded: number, totalBytes: number | null) => void | Promise<void>
) {
  const backup = await prisma.backupJob.findUnique({ where: { id: backupId } });
  if (!backup) throw new Error("Backup not found");
  const remoteBackup = await getRemoteBackup(backupId, connectionId);
  await logActivity("restore", "Downloading verified remote backup for restore", "info", {
    backupId,
    siteId: backup.siteId,
    sourceProvider: remoteBackup.providerType,
    cloudConnectionId: connectionId,
    remoteFileIds: remoteBackup.files.map((file) => file.remoteId)
  });
  const downloaded = await downloadRemoteCopy(backupId, connectionId, onDownloadProgress);
  try {
    await runRestore(backup.siteId, backup.id, {
      createSafetySnapshot: true,
      artifactPaths: {
        dbDumpPath: downloaded.dbDumpPath,
        filesArchivePath: downloaded.filesArchivePath
      }
    });
  } finally {
    await fs.promises.rm(downloaded.destinationDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
