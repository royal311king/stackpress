import type { CloudStorageConnection } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type CloudConnectionRecord = CloudStorageConnection;

export type CreateCloudConnectionRecord = Omit<
  CloudConnectionRecord,
  "id" | "createdAt" | "updatedAt" | "lastConnectedAt" | "lastTestedAt" | "lastSuccessfulTestAt" | "lastError"
>;

export type UpdateCloudConnectionRecord = Partial<Omit<
  CloudConnectionRecord,
  "id" | "createdAt" | "updatedAt"
>>;

export interface CloudConnectionRepository {
  create(data: CreateCloudConnectionRecord): Promise<CloudConnectionRecord>;
  findById(id: string): Promise<CloudConnectionRecord | null>;
  findMany(): Promise<CloudConnectionRecord[]>;
  update(id: string, data: UpdateCloudConnectionRecord): Promise<CloudConnectionRecord>;
  delete(id: string): Promise<void>;
}

export const prismaCloudConnectionRepository: CloudConnectionRepository = {
  create(data) {
    return prisma.cloudStorageConnection.create({ data });
  },
  findById(id) {
    return prisma.cloudStorageConnection.findUnique({ where: { id } });
  },
  findMany() {
    return prisma.cloudStorageConnection.findMany({ orderBy: { createdAt: "asc" } });
  },
  update(id, data) {
    return prisma.cloudStorageConnection.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.cloudStorageConnection.delete({ where: { id } });
  }
};
