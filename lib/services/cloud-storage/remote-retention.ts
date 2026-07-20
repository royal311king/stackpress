import { prisma } from "@/lib/prisma";
import { deleteRemoteCopy } from "./remote-copies";

type Destination = { cloudConnectionId: string; retentionPolicy: string };
type RemoteFile = { id: string; cloudConnectionId: string; verificationStatus: string; deletionStatus: string };
type Connection = { id: string; enabled: boolean; status: string };

export type RemoteRetentionDependencies = {
  destinations(backupId: string): Promise<Destination[]>;
  files(backupId: string): Promise<RemoteFile[]>;
  connection(id: string): Promise<Connection | null>;
  hasActiveUpload(backupId: string): Promise<boolean>;
  hasActiveRestore(backupId: string): Promise<boolean>;
  updateFiles(ids: string[], patch: { deletionStatus: string; deletionAttemptedAt: Date; lastError: string | null }): Promise<void>;
  deleteCopy(backupId: string, connectionId: string): Promise<void>;
};

const prismaDependencies: RemoteRetentionDependencies = {
  async destinations(backupId) {
    const backup = await prisma.backupJob.findUnique({ where: { id: backupId }, select: { siteId: true } });
    if (!backup) return [];
    return prisma.siteCloudDestination.findMany({ where: { siteId: backup.siteId }, select: { cloudConnectionId: true, retentionPolicy: true } });
  },
  files(backupId) {
    return prisma.cloudBackupFile.findMany({ where: { backupId, remoteFileId: { not: null }, uploadStatus: { not: "deleted" } }, select: { id: true, cloudConnectionId: true, verificationStatus: true, deletionStatus: true } });
  },
  connection(id) {
    return prisma.cloudStorageConnection.findUnique({ where: { id }, select: { id: true, enabled: true, status: true } });
  },
  async hasActiveUpload(backupId) {
    return Boolean(await prisma.cloudUploadJob.findFirst({ where: { backupId, status: { in: ["queued", "running"] } }, select: { id: true } }));
  },
  async hasActiveRestore(backupId) {
    return Boolean(await prisma.remoteRestoreJob.findFirst({ where: { backupId, status: { in: ["queued", "running"] } }, select: { id: true } }));
  },
  async updateFiles(ids, patch) {
    await prisma.cloudBackupFile.updateMany({ where: { id: { in: ids } }, data: patch });
  },
  deleteCopy: deleteRemoteCopy
};

export async function cleanupRemoteCopiesForExpiredBackup(
  backupId: string,
  dependencies: RemoteRetentionDependencies = prismaDependencies
) {
  const [destinations, files, activeUpload, activeRestore] = await Promise.all([
    dependencies.destinations(backupId),
    dependencies.files(backupId),
    dependencies.hasActiveUpload(backupId),
    dependencies.hasActiveRestore(backupId)
  ]);
  if (activeUpload || activeRestore || files.some((file) => file.verificationStatus === "verifying")) return false;

  const deleteDestinations = destinations.filter((destination) => destination.retentionPolicy === "delete_with_local");
  for (const destination of deleteDestinations) {
    const remoteFiles = files.filter((file) => file.cloudConnectionId === destination.cloudConnectionId && file.deletionStatus !== "deleted");
    if (!remoteFiles.length) continue;
    const connection = await dependencies.connection(destination.cloudConnectionId);
    if (!connection?.enabled || connection.status !== "connected") {
      await dependencies.updateFiles(remoteFiles.map((file) => file.id), {
        deletionStatus: "cleanup_unavailable",
        deletionAttemptedAt: new Date(),
        lastError: "Remote retention unavailable until the provider is reconnected"
      });
      return false;
    }
    try {
      await dependencies.deleteCopy(backupId, destination.cloudConnectionId);
    } catch (error) {
      const latestFiles = await dependencies.files(backupId);
      await dependencies.updateFiles(
        latestFiles.filter((file) => file.cloudConnectionId === destination.cloudConnectionId && file.deletionStatus !== "deleted").map((file) => file.id),
        { deletionStatus: "failed", deletionAttemptedAt: new Date(), lastError: error instanceof Error ? error.message : "Remote retention deletion failed" }
      );
      return false;
    }
  }
  return true;
}
