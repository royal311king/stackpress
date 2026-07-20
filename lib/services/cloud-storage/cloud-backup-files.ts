import type { CloudBackupFile } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { RemoteFileKind } from "./types";

export type CloudBackupFileRecord = CloudBackupFile;

export type CloudBackupFileKey = {
  cloudConnectionId: string;
  backupId: string;
  artifactKind: RemoteFileKind;
};

export type PendingCloudBackupFile = CloudBackupFileKey & {
  siteId: string;
  provider: string;
  remoteName: string;
  localSize: bigint;
  localChecksum: string;
  checksumAlgorithm: string;
};

export type CloudBackupFilePatch = Partial<Omit<
  CloudBackupFileRecord,
  "id" | "cloudConnectionId" | "backupId" | "artifactKind" | "createdAt" | "updatedAt"
>>;

export interface CloudBackupFileRepository {
  upsertPending(input: PendingCloudBackupFile): Promise<CloudBackupFileRecord>;
  findByKey(key: CloudBackupFileKey): Promise<CloudBackupFileRecord | null>;
  findForBackup(connectionId: string, backupId: string): Promise<CloudBackupFileRecord[]>;
  update(id: string, patch: CloudBackupFilePatch): Promise<CloudBackupFileRecord>;
}

export const prismaCloudBackupFileRepository: CloudBackupFileRepository = {
  upsertPending(input) {
    const { cloudConnectionId, backupId, artifactKind, ...data } = input;
    return prisma.cloudBackupFile.upsert({
      where: {
        cloudConnectionId_backupId_artifactKind: {
          cloudConnectionId,
          backupId,
          artifactKind
        }
      },
      update: {
        ...data,
        uploadStatus: "pending",
        verificationStatus: "idle",
        deletionStatus: "not_requested",
        deletionAttemptedAt: null,
        deletedAt: null,
        lastError: null
      },
      create: {
        cloudConnectionId,
        backupId,
        artifactKind,
        ...data,
        uploadStatus: "pending"
      }
    });
  },
  findByKey(key) {
    return prisma.cloudBackupFile.findUnique({
      where: {
        cloudConnectionId_backupId_artifactKind: key
      }
    });
  },
  findForBackup(connectionId, backupId) {
    return prisma.cloudBackupFile.findMany({
      where: { cloudConnectionId: connectionId, backupId },
      orderBy: { createdAt: "asc" }
    });
  },
  update(id, patch) {
    return prisma.cloudBackupFile.update({ where: { id }, data: patch });
  }
};
