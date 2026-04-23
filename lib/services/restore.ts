import { prisma } from "@/lib/prisma";
import { pathExists } from "@/lib/filesystem";
import { runCommand } from "@/lib/shell";
import { logActivity } from "@/lib/services/logging";

export async function runRestore(siteId: string, backupId?: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new Error("Site not found");
  }

  const backup =
    (backupId
      ? await prisma.backupJob.findUnique({ where: { id: backupId } })
      : await prisma.backupJob.findFirst({
          where: { siteId, status: "completed" },
          orderBy: { completedAt: "desc" }
        })) ?? null;

  if (!backup) {
    throw new Error("No completed backup available for restore");
  }

  if (backup.filesArchivePath && !pathExists(backup.filesArchivePath)) {
    throw new Error("Backup archive file is missing");
  }

  if (backup.dbDumpPath && !pathExists(backup.dbDumpPath)) {
    throw new Error("Backup SQL file is missing");
  }

  await logActivity("restore", `Restore started for ${site.name}`, "warn", {
    siteId,
    backupId: backup.id
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
    await logActivity("restore", `Extracting files for ${site.name}`, "warn", {
      siteId,
      backupId: backup.id
    });
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

  await logActivity("restore", `Starting database container for ${site.name}`, "warn", {
    siteId,
    backupId: backup.id
  });
  const startDbResult = await runCommand("docker", ["start", site.dbContainerName], {
    cwd: site.siteDirectory
  });
  if (startDbResult.code !== 0) {
    throw new Error(startDbResult.stderr || "Failed to start database container");
  }

  if (backup.dbDumpPath) {
    await logActivity("restore", `Importing SQL backup for ${site.name}`, "warn", {
      siteId,
      backupId: backup.id
    });
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

  await logActivity("restore", `Restarting full stack for ${site.name}`, "warn", {
    siteId,
    backupId: backup.id
  });

  for (const containerName of [site.dbContainerName, site.wordpressContainerName]) {
    const restartResult = await runCommand("docker", ["start", containerName], {
      cwd: site.siteDirectory
    });
    if (restartResult.code !== 0) {
      throw new Error(restartResult.stderr || `Failed to start container ${containerName}`);
    }
  }

  await logActivity("restore", `Restore completed for ${site.name}`, "warn", {
    siteId,
    backupId: backup.id
  });
}
