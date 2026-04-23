import fs from "node:fs";
import path from "node:path";
import { BackupJob, Site } from "@prisma/client";
import { format } from "date-fns";

import { ensureDirectory, getDirectoryUsage, getFileSize, pathExists } from "@/lib/filesystem";
import { prisma } from "@/lib/prisma";
import { runCommand } from "@/lib/shell";
import { logActivity } from "@/lib/services/logging";
import { getAppSettings } from "@/lib/services/settings";

const BACKUP_SUCCESS_STATUS = "success" as const;
const BACKUP_SUCCESS_WITH_WARNINGS_STATUS = "success_with_warnings" as const;

export const RESTORABLE_BACKUP_STATUSES = [
  BACKUP_SUCCESS_STATUS,
  BACKUP_SUCCESS_WITH_WARNINGS_STATUS,
  "completed"
] as const;

export type BackupRunResult = {
  backupId: string;
  status: typeof BACKUP_SUCCESS_STATUS | typeof BACKUP_SUCCESS_WITH_WARNINGS_STATUS;
  warningMessage: string | null;
};

// Default file exclusions for active WordPress sites. These are intentionally
// code-visible for easy extension even before they are surfaced in the UI.
export const DEFAULT_FILE_ARCHIVE_EXCLUSIONS = [
  "html/wp-content/cache",
  "html/wp-content/cache/*",
  "html/wp-content/uploads/cache",
  "html/wp-content/uploads/cache/*",
  "html/wp-content/upgrade",
  "html/wp-content/upgrade/*",
  "html/wp-content/ai1wm-backups",
  "html/wp-content/ai1wm-backups/*",
  "html/wp-content/backups",
  "html/wp-content/backups/*",
  "html/wp-content/backup*",
  "html/wp-content/wflogs",
  "html/wp-content/wflogs/*",
  "html/wp-content/debug.log",
  "html/wp-content/tmp",
  "html/wp-content/tmp/*",
  "html/wp-content/temp",
  "html/wp-content/temp/*",
  "html/wp-content/sessions",
  "html/wp-content/sessions/*",
  "html/wp-content/logs",
  "html/wp-content/logs/*"
] as const;

function getTriggerLabel(triggerSource: string) {
  if (triggerSource === "schedule") {
    return "Scheduled";
  }

  if (triggerSource === "bulk") {
    return "Bulk";
  }

  return "Manual";
}

export function normalizeWarningMessage(message: string) {
  return message.trim().replace(/\s+/g, " ");
}

export function isRecoverableTarWarning(code: number, stderr: string, archivePath: string) {
  if (code === 0) {
    return false;
  }

  const normalized = normalizeWarningMessage(stderr).toLowerCase();
  return code === 1 && pathExists(archivePath) && normalized.includes("file changed as we read it");
}

export function getSiteRootDirectory(site: Pick<Site, "backupDestination" | "slug">) {
  const normalizedDestination = path.resolve(site.backupDestination);
  const destinationName = path.basename(normalizedDestination);

  return destinationName === site.slug
    ? normalizedDestination
    : path.join(normalizedDestination, site.slug);
}

export function getSiteBackupDirectory(site: Pick<Site, "backupDestination" | "slug">) {
  return path.join(getSiteRootDirectory(site), "stackpress");
}

export function getPreRestoreSnapshotDirectory(site: Pick<Site, "backupDestination" | "slug">) {
  return path.join(getSiteBackupDirectory(site), "pre-restore");
}

export function buildTarArgs(siteDirectory: string, filesArchivePath: string) {
  const excludeArgs = DEFAULT_FILE_ARCHIVE_EXCLUSIONS.flatMap((pattern) => ["--exclude", pattern]);
  return ["-czf", filesArchivePath, ...excludeArgs, "-C", siteDirectory, "html"];
}

async function updateJob(jobId: string, patch: Partial<BackupJob>) {
  return prisma.backupJob.update({
    where: { id: jobId },
    data: patch
  });
}

async function logBackupActivity(
  level: "info" | "warn" | "error",
  triggerSource: string,
  site: Pick<Site, "id" | "name">,
  backupId: string,
  message: string,
  meta?: Record<string, unknown>
) {
  await logActivity("backup", `${getTriggerLabel(triggerSource)} ${message} for ${site.name}`, level, {
    siteId: site.id,
    backupId,
    triggerSource,
    ...meta
  });
}

function getAvailableDiskKb(dfOutput: string) {
  const lines = dfOutput.trim().split("\n");
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  return Number(fields[3] ?? 0);
}

async function failJob(site: Site, jobId: string, error: unknown, triggerSource: string) {
  const message = error instanceof Error ? error.message : "Unknown backup failure";
  const failedAt = new Date();

  await updateJob(jobId, {
    status: "failed",
    completedAt: failedAt,
    errorMessage: message,
    progressStep: "failed"
  });

  await prisma.site.update({
    where: { id: site.id },
    data: {
      lastBackupAt: failedAt,
      lastBackupStatus: "failed",
      lastBackupMessage: message
    }
  });

  await logBackupActivity("error", triggerSource, site, jobId, "backup failed", {
    error: message
  });
}

export async function runBackup(siteId: string, triggerSource = "manual"): Promise<BackupRunResult> {
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

  await logBackupActivity("info", triggerSource, site, job.id, "backup started", {
    backupType: site.backupMode
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

    const availableKb = getAvailableDiskKb(diskCheck.stdout);
    const thresholdKb = settings.diskFreeThresholdGb * 1024 * 1024;
    if (availableKb < thresholdKb) {
      throw new Error(
        `Free disk space is below the configured threshold of ${settings.diskFreeThresholdGb} GB`
      );
    }

    const siteDestination = getSiteBackupDirectory(site);
    ensureDirectory(siteDestination);

    const stamp = format(startedAt, "yyyy-MM-dd_HH-mm-ss");
    const dbDumpPath = path.join(siteDestination, `db-${stamp}.sql`);
    const filesArchivePath = path.join(siteDestination, `files-${stamp}.tar.gz`);
    const manifestPath = path.join(siteDestination, `manifest-${stamp}.json`);
    const warnings: string[] = [];

    if (site.backupMode !== "files") {
      await updateJob(job.id, { progressStep: "dumping-db" });

      const dumpResult = await runCommand("docker", [
        "exec",
        site.dbContainerName,
        "mysqldump",
        `-u${site.dbUser}`,
        `-p${site.dbPassword}`,
        site.dbName,
        "--result-file",
        `/tmp/db-${stamp}.sql`
      ]);
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
      const tarResult = await runCommand("tar", buildTarArgs(site.siteDirectory, filesArchivePath));
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
      warnings,
      fileExclusions: [...DEFAULT_FILE_ARCHIVE_EXCLUSIONS]
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const totalBytes = BigInt(getFileSize(dbDumpPath) + getFileSize(filesArchivePath));
    const completedAt = new Date();
    const hasWarnings = warnings.length > 0;
    const finalStatus = hasWarnings ? BACKUP_SUCCESS_WITH_WARNINGS_STATUS : BACKUP_SUCCESS_STATUS;
    const warningMessage = hasWarnings
      ? `Backup completed with warnings: ${warnings.join(" | ")}`
      : null;

    await updateJob(job.id, {
      status: finalStatus,
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
        lastBackupStatus: finalStatus,
        lastBackupMessage: warningMessage ?? "Backup completed successfully"
      }
    });

    await enforceRetention(site.id);
    await logBackupActivity(
      hasWarnings ? "warn" : "info",
      triggerSource,
      site,
      job.id,
      hasWarnings ? "backup completed with warnings" : "backup completed",
      {
        storageBytes: getDirectoryUsage(siteDestination),
        warnings,
        siteDestination,
        fileExclusions: DEFAULT_FILE_ARCHIVE_EXCLUSIONS,
        status: finalStatus
      }
    );

    return {
      backupId: job.id,
      status: finalStatus,
      warningMessage
    };
  } catch (error) {
    await failJob(site, job.id, error, triggerSource);
    throw error;
  }
}

export async function enforceRetention(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    return;
  }

  const backups = await prisma.backupJob.findMany({
    where: { siteId, status: { in: [...RESTORABLE_BACKUP_STATUSES] } },
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
