import cron from "node-cron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { restoreRemoteCopy } from "./remote-copies";
import { CloudProviderError, requiredBackupArtifactKinds } from "./types";
import { cloudConnectionService } from "./connections";

const STALE_MS = 10 * 60_000;
const STALE_TEMP_DIRECTORY_MS = 24 * 60 * 60_000;
let started = false;
let processing = false;

export async function enqueueRemoteRestore(backupId: string, cloudConnectionId: string) {
  const [backup, connection, verifiedFiles] = await Promise.all([
    prisma.backupJob.findUnique({ where: { id: backupId } }),
    prisma.cloudStorageConnection.findUnique({ where: { id: cloudConnectionId } }),
    prisma.cloudBackupFile.findMany({ where: { backupId, cloudConnectionId, uploadStatus: "success", remoteFileId: { not: null } } })
  ]);
  if (!backup) throw new Error("Backup not found");
  const requiredKinds = requiredBackupArtifactKinds(backup.backupType);
  const localPaths = {
    database: backup.dbDumpPath,
    files: backup.filesArchivePath
  };
  const localAvailable = requiredKinds.every((kind) => {
    const file = localPaths[kind as keyof typeof localPaths];
    return Boolean(file && fs.existsSync(file));
  });
  if (localAvailable) throw new Error("Local backup files are available; use the existing local restore action");
  if (!connection?.enabled || connection.status !== "connected") throw new Error("Google Drive connection must be reauthorized before restore");
  const verifiedKinds = new Set(
    verifiedFiles
      .filter((file) => file.verifiedAt && file.verificationStatus === "verified")
      .map((file) => file.artifactKind)
  );
  if (!requiredKinds.every((kind) => verifiedKinds.has(kind))) {
    throw new Error(`Verified Google Drive ${requiredKinds.join(" and ")} artifacts are required for remote restore`);
  }
  const existing = await prisma.remoteRestoreJob.findUnique({
    where: { backupId_cloudConnectionId: { backupId, cloudConnectionId } }
  });
  if (existing && ["queued", "running"].includes(existing.status)) return existing;
  return prisma.remoteRestoreJob.upsert({
    where: { backupId_cloudConnectionId: { backupId, cloudConnectionId } },
    create: { backupId, cloudConnectionId, provider: connection.provider, status: "queued" },
    update: { status: "queued", startedAt: null, completedAt: null, heartbeatAt: null, lastError: null }
  });
}

export async function recoverInterruptedRemoteRestores(now = new Date()) {
  return prisma.remoteRestoreJob.updateMany({
    where: { status: "running", OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) } }] },
    data: { status: "queued", startedAt: null, lastError: "Restore interrupted and safely requeued after restart" }
  });
}

export async function cleanupStaleRestoreDirectories(now = new Date(), temporaryRoot = os.tmpdir()) {
  const entries = await fs.promises.readdir(temporaryRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("stackpress-restore-"))
    .map(async (entry) => {
      const target = path.join(temporaryRoot, entry.name);
      const stat = await fs.promises.stat(target).catch(() => null);
      if (stat && stat.mtimeMs < now.getTime() - STALE_TEMP_DIRECTORY_MS) {
        await fs.promises.rm(target, { recursive: true, force: true });
      }
    }));
}

async function processJob(id: string) {
  const now = new Date();
  const claimed = await prisma.remoteRestoreJob.updateMany({
    where: { id, status: "queued" },
    data: { status: "running", attempts: { increment: 1 }, startedAt: now, heartbeatAt: now, lastError: null }
  });
  if (!claimed.count) return;
  const job = await prisma.remoteRestoreJob.findUnique({ where: { id } });
  if (!job) return;
  const heartbeat = setInterval(() => {
    void prisma.remoteRestoreJob.updateMany({
      where: { id, status: "running" },
      data: { heartbeatAt: new Date() }
    }).catch(() => {});
  }, 30_000);
  try {
    let lastHeartbeat = 0;
    await restoreRemoteCopy(job.backupId, job.cloudConnectionId, async () => {
      const heartbeatNow = Date.now();
      if (heartbeatNow - lastHeartbeat < 5_000) return;
      lastHeartbeat = heartbeatNow;
      await prisma.remoteRestoreJob.update({
        where: { id },
        data: { heartbeatAt: new Date(heartbeatNow) }
      });
    });
    await prisma.remoteRestoreJob.update({ where: { id }, data: { status: "completed", completedAt: new Date(), heartbeatAt: new Date() } });
  } catch (error) {
    const needsAuth = error instanceof CloudProviderError && ["authentication_failed", "authorization_failed"].includes(error.code);
    const message = error instanceof Error ? error.message : "Remote restore failed";
    await prisma.remoteRestoreJob.update({ where: { id }, data: { status: needsAuth ? "needs_auth" : "failed", completedAt: new Date(), heartbeatAt: new Date(), lastError: message } });
    if (needsAuth) await cloudConnectionService.markNeedsReauthorization(job.cloudConnectionId, message).catch(() => {});
    await logActivity("restore", "Remote restore failed", "error", { backupId: job.backupId, cloudConnectionId: job.cloudConnectionId, provider: job.provider, error: message }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
  }
}

async function tick() {
  if (processing) return;
  processing = true;
  try {
    const jobs = await prisma.remoteRestoreJob.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: 1 });
    for (const job of jobs) await processJob(job.id);
  } finally {
    processing = false;
  }
}

export async function startRemoteRestoreWorker() {
  if (started) return;
  started = true;
  await recoverInterruptedRemoteRestores();
  await cleanupStaleRestoreDirectories();
  void tick();
  cron.schedule("*/5 * * * * *", () => void tick());
}
