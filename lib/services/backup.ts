import fs from "node:fs";
import path from "node:path";
import { BackupJob, Site } from "@prisma/client";
import { format } from "date-fns";

import { ensureDirectory, getDirectoryUsage, getFileSize, pathExists } from "@/lib/filesystem";
import { prisma } from "@/lib/prisma";
import { runCommand } from "@/lib/shell";
import { logActivity } from "@/lib/services/logging";
import { getAppSettings } from "@/lib/services/settings";

type ProgressStep = "queued" | "checking" | "dumping-db" | "archiving-files" | "writing-manifest" | "complete";

function normalizeWarningMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

function isRecoverableTarWarning(code: number, stderr: string, archivePath: string) {
  if (code === 0) {
    return false;
  }

  const normalized = normalizeWarningMessage(stderr).toLowerCase();
  return code === 1 && pathExists(archivePath) && normalized.includes("file changed as we read it");
}

async function updateJob(jobId: string, patch: Partial<BackupJob>) {
  return prisma.backupJob.update({
    where: { id: jobId },
    data: patch
  });
}

async function failJob(site: Site, jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown backup failure";
  await updateJob(jobId, {
    status: "failed",
    completedAt: new Date(),
    errorMessage: message,
    progressStep: "failed"
  });
  await prisma.site.update({
    where: { id: site.id },
    data: {
      lastBackupAt: new Date(),
      lastBackupStatus: "failed",
      lastBackupMessage: message
    }
  });
  await logActivity("backup", `Backup failed for ${site.name}`, "error", {
    siteId: site.id,
    error: message
  });
}

export async function runBackup(siteId: string, triggerSource = "manual") {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new Error("Site not found");
  }

  const settings = await getAppSettings();

  const activeJob = await prisma.backupJob.findFirst({
    where: {
      siteId,
      status: { in: ["queued", "running"] }
    }
  });

  if (activeJob) {
    throw new Error("A backup is already running for this site");
  }

  const startedAt = new Date();
  const job = await prisma.backupJob.create({
    data: {
      siteId,
      triggerSource,
      backupType: site.backupMode,
      status: "running",
      startedAt,
      progressStep: "checking"
    }
  });

  try {
    if (!pathExists(site.siteDirectory)) {
      throw new Error("Site directory does not exist");
    }

    if (!pathExists(site.backupDestination)) {
      throw new Error("Backup destination does not exist");
    }

    const diskCheck = await runCommand("df", ["-Pk", site.backupDestination]);
    if (diskCheck.code !== 0) {
      throw new Error(diskCheck.stderr || "Unable to determine free disk space");
    }

    const lines = diskCheck.stdout.trim().split("\n");
    const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
    const availableKb = Number(fields[3] ?? 0);
    const thresholdKb = settings.diskFreeThresholdGb * 1024 * 1024;
    if (availableKb < thresholdKb) {
      throw new Error(
        `Free disk space is below the configured threshold of ${settings.diskFreeThresholdGb} GB`
      );
    }

    const siteDestination = path.join(site.backupDestination, site.slug);
    ensureDirectory(siteDestination);

    const stamp = format(startedAt, "yyyy-MM-dd_HH-mm-ss");
    const dbDumpPath = path.join(siteDestination, `db-${stamp}.sql`);
    const filesArchivePath = path.join(siteDestination, `files-${stamp}.tar.gz`);
    const manifestPath = path.join(siteDestination, `manifest-${stamp}.json`);
    const warnings: string[] = [];

    if (site.backupMode !== "files") {
      await updateJob(job.id, { progressStep: "dumping-db" });

      const dumpArgs = [
        "exec",
        site.dbContainerName,
        "mysqldump",
        `-u${site.dbUser}`,
        `-p${site.dbPassword}`,
        site.dbName,
        "--result-file",
        `/tmp/db-${stamp}.sql`
      ];
      const dumpResult = await runCommand("docker", dumpArgs);
      if (dumpResult.code !== 0) {
        throw new Error(dumpResult.stderr || "mysqldump command failed");
      }

      const copyResult = await runCommand("docker", [
        "cp",
        `${site.dbContainerName}:/tmp/db-${stamp}.sql`,
        dbDumpPath
      ]);
      if (copyResult.code !== 0) {
        throw new Error(copyResult.stderr || "Failed to copy SQL dump from container");
      }
    }

    if (site.backupMode !== "database") {
      await updateJob(job.id, { progressStep: "archiving-files" });

      const htmlPath = path.join(site.siteDirectory, "html");
      const tarResult = await runCommand("tar", ["-czf", filesArchivePath, "-C", site.siteDirectory, "html"]);
      const tarWarning = normalizeWarningMessage(tarResult.stderr);

      if (isRecoverableTarWarning(tarResult.code, tarResult.stderr, filesArchivePath)) {
        warnings.push(tarWarning);
      } else if (tarResult.code !== 0) {
        throw new Error(tarResult.stderr || "Failed to archive site files");
      }

      if (!pathExists(htmlPath)) {
        throw new Error("Expected html directory does not exist");
      }
    }

    await updateJob(job.id, { progressStep: "writing-manifest" });

    const manifest = {
      timestamp: startedAt.toISOString(),
      siteId: site.id,
      siteSlug: site.slug,
      backupType: site.backupMode,
      dbDumpPath: fs.existsSync(dbDumpPath) ? dbDumpPath : null,
      filesArchivePath: fs.existsSync(filesArchivePath) ? filesArchivePath : null,
      dbBytes: getFileSize(dbDumpPath),
      filesBytes: getFileSize(filesArchivePath),
      warnings
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const totalBytes = BigInt(getFileSize(dbDumpPath) + getFileSize(filesArchivePath));
    const completedAt = new Date();
    const warningMessage =
      warnings.length > 0 ? `Backup completed with warnings: ${warnings.join(" | ")}` : null;

    await updateJob(job.id, {
      status: "completed",
      completedAt,
      durationSeconds: Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)),
      totalBytes,
      dbDumpPath: fs.existsSync(dbDumpPath) ? dbDumpPath : null,
      filesArchivePath: fs.existsSync(filesArchivePath) ? filesArchivePath : null,
      manifestPath,
      progressStep: "complete",
      logExcerpt: warningMessage,
      errorMessage: null
    });

    await prisma.site.update({
      where: { id: site.id },
      data: {
        lastBackupAt: completedAt,
        lastBackupStatus: "completed",
        lastBackupMessage: warningMessage ?? "Backup completed successfully"
      }
    });

    await enforceRetention(site.id);
    await logActivity(
      "backup",
      warnings.length > 0
        ? `Backup completed with warnings for ${site.name}`
        : `Backup completed for ${site.name}`,
      warnings.length > 0 ? "warn" : "info",
      {
        siteId: site.id,
        storageBytes: getDirectoryUsage(siteDestination),
        warnings
      }
    );
  } catch (error) {
    await failJob(site, job.id, error);
    throw error;
  }
}

export async function enforceRetention(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    return;
  }

  const backups = await prisma.backupJob.findMany({
    where: { siteId, status: "completed" },
    orderBy: { completedAt: "desc" }
  });

  const newestId = backups[0]?.id;
  const now = Date.now();

  for (const [index, backup] of backups.entries()) {
    const tooMany = index >= site.retentionCount;
    const tooOld =
      typeof site.retentionDays === "number" &&
      backup.completedAt &&
      now - backup.completedAt.getTime() > site.retentionDays * 86400000;
    const protectNewest = site.neverDeleteNewest && backup.id === newestId;

    if ((tooMany || tooOld) && !protectNewest) {
      if (backup.dbDumpPath && fs.existsSync(backup.dbDumpPath)) {
        fs.unlinkSync(backup.dbDumpPath);
      }
      if (backup.filesArchivePath && fs.existsSync(backup.filesArchivePath)) {
        fs.unlinkSync(backup.filesArchivePath);
      }
      if (backup.manifestPath && fs.existsSync(backup.manifestPath)) {
        fs.unlinkSync(backup.manifestPath);
      }
      await prisma.backupJob.delete({ where: { id: backup.id } });
    }
  }
}
