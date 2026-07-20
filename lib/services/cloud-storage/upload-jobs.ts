import type { CloudUploadJob } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { cloudConnectionService } from "./connections";
import { registerBuiltInCloudStorageProviders } from "./providers";
import { createCloudStorageProvider } from "./registry";
import { assertCloudUploadEligibleBackup, CloudProviderError, type CloudProviderType } from "./types";
import { destinationAppliesToTrigger } from "./site-destinations";

export const ACTIVE_CLOUD_UPLOAD_STATUSES = ["queued", "running"] as const;
const STALE_JOB_MS = 5 * 60_000;

export function cloudUploadDedupeKey(backupId: string, cloudConnectionId: string) {
  return `${backupId}:${cloudConnectionId}`;
}

export function classifyCloudUploadFailure(error: unknown, attempts: number, maxAttempts: number) {
  const needsAuth = error instanceof CloudProviderError &&
    ["authentication_failed", "authorization_failed"].includes(error.code);
  const retryable = error instanceof CloudProviderError && error.retryable;
  return needsAuth ? "needs_auth" : retryable && attempts < maxAttempts ? "queued" : "failed";
}

export function isStaleCloudUpload(heartbeatAt: Date | null, now = new Date()) {
  return heartbeatAt === null || heartbeatAt.getTime() < now.getTime() - STALE_JOB_MS;
}

export async function enqueueCloudUploadsForBackup(backupId: string) {
  const backup = await prisma.backupJob.findUnique({ where: { id: backupId } });
  if (!backup) throw new Error("Backup not found");
  assertCloudUploadEligibleBackup(backup, "google_drive");

  const [destinations, connections] = await Promise.all([
    prisma.siteCloudDestination.findMany({ where: { siteId: backup.siteId } }),
    cloudConnectionService.list()
  ]);
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const selected = destinations.filter((destination) => {
    const connection = connectionsById.get(destination.cloudConnectionId);
    return Boolean(connection?.enabled && connection.status === "connected" &&
      destinationAppliesToTrigger(destination, backup.triggerSource));
  });

  return Promise.all(selected.map((destination) => {
    const connection = connectionsById.get(destination.cloudConnectionId)!;
    return prisma.cloudUploadJob.upsert({
    where: {
      backupId_cloudConnectionId: { backupId, cloudConnectionId: connection.id }
    },
    create: {
      backupId,
      cloudConnectionId: connection.id,
      provider: connection.provider,
      destinationConfigJson: JSON.stringify({
        siteFolderName: destination.remoteFolderName || undefined,
        ...JSON.parse(destination.providerConfigJson || "{}")
      }),
      status: "queued"
    },
    update: {}
  });
  }));
}

export async function enqueueCloudUpload(backupId: string, cloudConnectionId: string) {
  const [backup, connection] = await Promise.all([
    prisma.backupJob.findUnique({ where: { id: backupId } }),
    cloudConnectionService.get(cloudConnectionId)
  ]);
  if (!backup) throw new Error("Backup not found");
  assertCloudUploadEligibleBackup(backup, connection.provider);
  if (!connection.enabled || connection.status !== "connected") {
    throw new Error("Cloud destination must be enabled and connected");
  }
  const destination = await prisma.siteCloudDestination.findUnique({
    where: { siteId_cloudConnectionId: { siteId: backup.siteId, cloudConnectionId } }
  });
  if (!destination?.enabled) throw new Error("This cloud destination is not enabled for the site");

  return prisma.cloudUploadJob.upsert({
    where: { backupId_cloudConnectionId: { backupId, cloudConnectionId } },
    create: {
      backupId,
      cloudConnectionId,
      provider: connection.provider,
      destinationConfigJson: JSON.stringify({
        siteFolderName: destination.remoteFolderName || undefined,
        ...JSON.parse(destination.providerConfigJson || "{}")
      }),
      status: "queued"
    },
    update: {}
  });
}

export async function retryCloudUpload(jobId: string) {
  const job = await prisma.cloudUploadJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Cloud upload job not found");
  if (!["failed", "needs_auth"].includes(job.status)) {
    throw new Error("Only failed cloud uploads can be retried");
  }
  const connection = await cloudConnectionService.get(job.cloudConnectionId);
  if (!connection.enabled || connection.status !== "connected") {
    throw new Error("Reconnect and enable the cloud destination before retrying");
  }
  return prisma.cloudUploadJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      progressPercent: 0,
      nextAttemptAt: new Date(),
      startedAt: null,
      completedAt: null,
      heartbeatAt: null,
      lastError: null
    }
  });
}

async function claim(job: CloudUploadJob) {
  const now = new Date();
  const claimed = await prisma.cloudUploadJob.updateMany({
    where: { id: job.id, status: "queued", nextAttemptAt: { lte: now } },
    data: {
      status: "running",
      attempts: { increment: 1 },
      startedAt: now,
      heartbeatAt: now,
      progressPercent: 0,
      lastError: null
    }
  });
  return claimed.count === 1;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown cloud upload failure";
}

export async function processCloudUploadJob(job: CloudUploadJob) {
  if (!(await claim(job))) return false;
  const claimed = await prisma.cloudUploadJob.findUnique({ where: { id: job.id } });
  if (!claimed) return false;

  const backup = await prisma.backupJob.findUnique({
    where: { id: claimed.backupId },
    include: { site: true }
  });
  if (!backup) {
    await prisma.cloudUploadJob.update({
      where: { id: claimed.id },
      data: { status: "failed", completedAt: new Date(), lastError: "Local backup record no longer exists" }
    });
    return true;
  }

  try {
    assertCloudUploadEligibleBackup(backup, claimed.provider as CloudProviderType);
    registerBuiltInCloudStorageProviders();
    const context = await cloudConnectionService.getProviderContext(claimed.cloudConnectionId);
    const provider = createCloudStorageProvider({
      ...context,
      connection: {
        ...context.connection,
        config: { ...context.connection.config, ...JSON.parse(claimed.destinationConfigJson || "{}") }
      }
    });
    let lastProgressWriteAt = 0;
    let lastProgressPercent = -1;
    const result = await provider.uploadBackup({ backup, site: backup.site }, async (progress) => {
      const progressPercent = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
      const progressNow = Date.now();
      if (
        progressPercent < 100 &&
        progressPercent === lastProgressPercent &&
        progressNow - lastProgressWriteAt < 1_000
      ) {
        return;
      }
      lastProgressPercent = progressPercent;
      lastProgressWriteAt = progressNow;
      await prisma.cloudUploadJob.update({
        where: { id: claimed.id },
        data: {
          progressPercent,
          heartbeatAt: new Date(progressNow)
        }
      });
    });
    await prisma.cloudUploadJob.update({
      where: { id: claimed.id },
      data: {
        status: "completed",
        progressPercent: 100,
        completedAt: new Date(),
        heartbeatAt: new Date(),
        lastError: null
      }
    });
    await logActivity("cloud_backup", `Cloud upload completed for ${backup.site.name}`, "info", {
      backupId: backup.id,
      siteId: backup.siteId,
      cloudUploadJobId: claimed.id,
      cloudConnectionId: claimed.cloudConnectionId,
      remoteFileIds: result.files.map((file) => file.remoteId)
    });
  } catch (error) {
    const retryable = error instanceof CloudProviderError && error.retryable;
    const retryAgain = retryable && claimed.attempts < claimed.maxAttempts;
    const status = classifyCloudUploadFailure(error, claimed.attempts, claimed.maxAttempts);
    const message = errorMessage(error);
    if (status === "needs_auth") {
      await cloudConnectionService.markNeedsReauthorization(claimed.cloudConnectionId, message).catch(() => {});
    }
    await prisma.cloudUploadJob.update({
      where: { id: claimed.id },
      data: {
        status,
        completedAt: retryAgain ? null : new Date(),
        heartbeatAt: new Date(),
        nextAttemptAt: retryAgain
          ? new Date(Date.now() + Math.min(30_000 * 2 ** (claimed.attempts - 1), 15 * 60_000))
          : claimed.nextAttemptAt,
        lastError: message
      }
    });
    await logActivity("cloud_backup", `Cloud upload ${status.replace("_", " ")} for ${backup.site.name}`, "error", {
      backupId: backup.id,
      siteId: backup.siteId,
      cloudUploadJobId: claimed.id,
      cloudConnectionId: claimed.cloudConnectionId,
      error: message
    }).catch(() => {});
  }
  return true;
}

export async function recoverStaleCloudUploadJobs(now = new Date()) {
  return prisma.cloudUploadJob.updateMany({
    where: {
      status: "running",
      OR: [
        { heartbeatAt: null },
        { heartbeatAt: { lt: new Date(now.getTime() - STALE_JOB_MS) } }
      ]
    },
    data: {
      status: "queued",
      nextAttemptAt: now,
      startedAt: null,
      lastError: "Upload interrupted; safely queued again after application restart"
    }
  });
}

export async function processCloudUploadQueue(limit = 4) {
  await recoverStaleCloudUploadJobs();
  const jobs = await prisma.cloudUploadJob.findMany({
    where: { status: "queued", nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit
  });
  await Promise.allSettled(jobs.map(processCloudUploadJob));
  return jobs.length;
}
