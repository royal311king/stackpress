import fs from "node:fs";
import path from "node:path";
import { format } from "date-fns";

import { ensureDirectory, getFileSize, pathExists } from "@/lib/filesystem";
import { prisma } from "@/lib/prisma";
import { runCommand } from "@/lib/shell";
import {
  buildTarArgs,
  getPreRestoreSnapshotDirectory,
  isRecoverableTarWarning,
  normalizeWarningMessage,
  RESTORABLE_BACKUP_STATUSES
} from "@/lib/services/backup";
import { logActivity } from "@/lib/services/logging";

export class SafetySnapshotRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetySnapshotRestoreError";
  }
}

function validateRestoreArtifacts(backupType: string, dbDumpPath?: string | null, filesArchivePath?: string | null) {
  if (backupType === "full") {
    if (!dbDumpPath && !filesArchivePath) {
      throw new Error("Selected full backup is missing both the database dump and the file archive");
    }
    if (!dbDumpPath) {
      throw new Error("Selected full backup is missing the database dump");
    }
    if (!filesArchivePath) {
      throw new Error("Selected full backup is missing the file archive");
    }
  }

  if (backupType === "database" && !dbDumpPath) {
    throw new Error("Selected database backup is missing the SQL dump");
  }

  if (backupType === "files" && !filesArchivePath) {
    throw new Error("Selected files backup is missing the archive");
  }

  if (filesArchivePath && !pathExists(filesArchivePath)) {
    throw new Error("Backup archive file is missing on disk");
  }

  if (dbDumpPath && !pathExists(dbDumpPath)) {
    throw new Error("Backup SQL file is missing on disk");
  }
}

type RestoreOptions = {
  createSafetySnapshot?: boolean;
  continueWithoutSafetySnapshot?: boolean;
};

type RestoreSite = {
  id: string;
  name: string;
  slug: string;
  backupDestination: string;
  siteDirectory: string;
  wordpressContainerName: string;
  dbContainerName: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
};

async function logRestoreActivity(
  level: "info" | "warn" | "error",
  site: Pick<RestoreSite, "id" | "name">,
  backupId: string,
  message: string,
  meta?: Record<string, unknown>
) {
  await logActivity("restore", message, level, {
    siteId: site.id,
    backupId,
    ...meta
  });
}

async function createSafetySnapshot(site: RestoreSite, backupId: string) {
  const startedAt = new Date();
  const stamp = format(startedAt, "yyyy-MM-dd_HH-mm-ss");
  const snapshotDirectory = getPreRestoreSnapshotDirectory(site);
  ensureDirectory(snapshotDirectory);

  const dbDumpPath = path.join(snapshotDirectory, `pre-restore-db-${stamp}.sql`);
  const filesArchivePath = path.join(snapshotDirectory, `pre-restore-files-${stamp}.tar.gz`);
  const manifestPath = path.join(snapshotDirectory, `pre-restore-manifest-${stamp}.json`);
  const warnings: string[] = [];

  await logRestoreActivity("warn", site, backupId, `Creating pre-restore safety snapshot for ${site.name}`, {
    snapshotDirectory
  });

  const dumpResult = await runCommand("docker", [
    "exec",
    site.dbContainerName,
    "mysqldump",
    `-u${site.dbUser}`,
    `-p${site.dbPassword}`,
    site.dbName,
    "--result-file",
    `/tmp/pre-restore-${stamp}.sql`
  ]);
  if (dumpResult.code !== 0) {
    throw new SafetySnapshotRestoreError(
      dumpResult.stderr || "Failed to create pre-restore database snapshot"
    );
  }

  const copyResult = await runCommand("docker", [
    "cp",
    `${site.dbContainerName}:/tmp/pre-restore-${stamp}.sql`,
    dbDumpPath
  ]);
  if (copyResult.code !== 0) {
    throw new SafetySnapshotRestoreError(
      copyResult.stderr || "Failed to copy pre-restore database snapshot from container"
    );
  }

  const htmlPath = path.join(site.siteDirectory, "html");
  if (pathExists(htmlPath)) {
    const tarResult = await runCommand("tar", buildTarArgs(site.siteDirectory, filesArchivePath));
    const tarWarning = normalizeWarningMessage(tarResult.stderr);

    if (isRecoverableTarWarning(tarResult.code, tarResult.stderr, filesArchivePath)) {
      warnings.push(`Safety snapshot files archive warning: ${tarWarning}`);
    } else if (tarResult.code !== 0) {
      warnings.push(tarResult.stderr || "Safety snapshot file archive failed");
    }
  } else {
    warnings.push("Safety snapshot skipped file archive because the current html directory does not exist");
  }

  const manifest = {
    kind: "pre_restore_snapshot",
    label: "Emergency rollback snapshot",
    timestamp: startedAt.toISOString(),
    siteId: site.id,
    siteSlug: site.slug,
    restoreBackupId: backupId,
    dbDumpPath: fs.existsSync(dbDumpPath) ? dbDumpPath : null,
    filesArchivePath: fs.existsSync(filesArchivePath) ? filesArchivePath : null,
    dbBytes: getFileSize(dbDumpPath),
    filesBytes: getFileSize(filesArchivePath),
    warnings
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  await logRestoreActivity(
    warnings.length > 0 ? "warn" : "info",
    site,
    backupId,
    warnings.length > 0
      ? `Pre-restore safety snapshot completed with warnings for ${site.name}`
      : `Pre-restore safety snapshot completed for ${site.name}`,
    {
      snapshotDirectory,
      dbDumpPath: manifest.dbDumpPath,
      filesArchivePath: manifest.filesArchivePath,
      warnings
    }
  );
}

export async function runRestore(siteId: string, backupId?: string, options: RestoreOptions = {}) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new Error("Site not found");
  }

  const backup =
    (backupId
      ? await prisma.backupJob.findUnique({ where: { id: backupId } })
      : await prisma.backupJob.findFirst({
          where: { siteId, status: { in: [...RESTORABLE_BACKUP_STATUSES] } },
          orderBy: { completedAt: "desc" }
        })) ?? null;

  if (
    !backup ||
    !RESTORABLE_BACKUP_STATUSES.includes(
      backup.status as (typeof RESTORABLE_BACKUP_STATUSES)[number]
    )
  ) {
    throw new Error("No successful backup available for restore");
  }

  validateRestoreArtifacts(backup.backupType, backup.dbDumpPath, backup.filesArchivePath);

  if (options.createSafetySnapshot) {
    try {
      await createSafetySnapshot(site, backup.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pre-restore safety snapshot failed";
      await logRestoreActivity("error", site, backup.id, `Pre-restore safety snapshot failed for ${site.name}`, {
        error: message
      });

      if (!options.continueWithoutSafetySnapshot) {
        throw new SafetySnapshotRestoreError(
          `${message}. You can continue without the safety snapshot or cancel this restore.`
        );
      }

      await logRestoreActivity("warn", site, backup.id, `Continuing restore without safety snapshot for ${site.name}`, {
        error: message
      });
    }
  }

  await logRestoreActivity("warn", site, backup.id, `Restore started for ${site.name}`, {
    createSafetySnapshot: Boolean(options.createSafetySnapshot)
  });

  for (const containerName of [site.wordpressContainerName, site.dbContainerName]) {
    const stopResult = await runCommand("docker", ["stop", containerName], {
      cwd: site.siteDirectory
    });
    if (stopResult.code !== 0) {
      throw new Error(stopResult.stderr || `Failed to stop container ${containerName} before restore`);
    }
  }

  if (backup.filesArchivePath) {
    await logRestoreActivity("warn", site, backup.id, `Extracting files for ${site.name}`);
    const extractResult = await runCommand("tar", [
      "-xzf",
      backup.filesArchivePath,
      "-C",
      site.siteDirectory
    ]);
    if (extractResult.code !== 0) {
      throw new Error(extractResult.stderr || "Failed to extract archive");
    }
  }

  await logRestoreActivity("warn", site, backup.id, `Starting database container for ${site.name}`);
  const startDbResult = await runCommand("docker", ["start", site.dbContainerName], {
    cwd: site.siteDirectory
  });
  if (startDbResult.code !== 0) {
    throw new Error(startDbResult.stderr || "Failed to start database container");
  }

  if (backup.dbDumpPath) {
    await logRestoreActivity("warn", site, backup.id, `Importing SQL backup for ${site.name}`);
    const importResult = await runCommand(
      "docker",
      [
        "exec",
        "-i",
        site.dbContainerName,
        "mysql",
        `-u${site.dbUser}`,
        `-p${site.dbPassword}`,
        site.dbName
      ],
      { stdinFile: backup.dbDumpPath }
    );
    if (importResult.code !== 0) {
      throw new Error(importResult.stderr || "Failed to import SQL backup");
    }
  }

  await logRestoreActivity("warn", site, backup.id, `Restarting full stack for ${site.name}`);

  for (const containerName of [site.dbContainerName, site.wordpressContainerName]) {
    const restartResult = await runCommand("docker", ["start", containerName], {
      cwd: site.siteDirectory
    });
    if (restartResult.code !== 0) {
      throw new Error(restartResult.stderr || `Failed to start container ${containerName}`);
    }
  }

  await logRestoreActivity("warn", site, backup.id, `Restore completed for ${site.name}`);
}
