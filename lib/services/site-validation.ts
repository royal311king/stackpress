import fs from "node:fs";
import path from "node:path";

import { runCommand } from "@/lib/shell";

export type SiteSetupValidationInput = {
  siteDirectory?: string | null;
  backupDestination?: string | null;
  uploadsPath?: string | null;
  wordpressContainerName?: string | null;
  dbContainerName?: string | null;
  dbName?: string | null;
  dbUser?: string | null;
  dbPassword?: string | null;
};

export type SiteSetupCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  canCreate?: boolean;
};

function clean(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function canRead(target: string) {
  fs.accessSync(target, fs.constants.R_OK);
}

function canWrite(target: string) {
  fs.accessSync(target, fs.constants.W_OK);
  const probe = path.join(target, `.stackpress-write-test-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
}

function pathCheck(key: string, label: string, target: string, options?: { writable?: boolean; missingMessage?: string; canCreate?: boolean }) {
  if (!target) {
    return {
      key,
      label,
      status: "fail" as const,
      message: `${label} is required.`
    };
  }

  if (!fs.existsSync(target)) {
    return {
      key,
      label,
      status: "fail" as const,
      message: options?.missingMessage ?? `${target} does not exist from inside StackPress.`,
      canCreate: options?.canCreate
    };
  }

  try {
    options?.writable ? canWrite(target) : canRead(target);
    return {
      key,
      label,
      status: "pass" as const,
      message: options?.writable ? `${target} exists and is writable.` : `${target} exists and is readable.`
    };
  } catch (error) {
    return {
      key,
      label,
      status: "fail" as const,
      message: error instanceof Error ? error.message : `${target} is not accessible.`
    };
  }
}

async function containerCheck(key: string, label: string, containerName: string) {
  if (!containerName) {
    return {
      key,
      label,
      status: "fail" as const,
      message: `${label} is required.`
    };
  }

  try {
    const result = await runCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerName]);
    if (result.code !== 0) {
      return {
        key,
        label,
        status: "fail" as const,
        message: result.stderr.trim() || `${containerName} was not found by Docker.`
      };
    }

    const running = result.stdout.trim() === "true";
    return {
      key,
      label,
      status: running ? "pass" as const : "warn" as const,
      message: running ? `${containerName} exists and is running.` : `${containerName} exists but is not running.`
    };
  } catch (error) {
    return {
      key,
      label,
      status: "fail" as const,
      message: error instanceof Error ? error.message : "Docker is not reachable from StackPress."
    };
  }
}

async function databaseCredentialCheck(input: SiteSetupValidationInput) {
  const dbContainerName = clean(input.dbContainerName);
  const dbName = clean(input.dbName);
  const dbUser = clean(input.dbUser);
  const dbPassword = clean(input.dbPassword);

  if (!dbContainerName || !dbName || !dbUser) {
    return {
      key: "dbCredentials",
      label: "DB credentials",
      status: "warn" as const,
      message: "DB credentials were not fully provided, so StackPress could not test them."
    };
  }

  const result = await runCommand("docker", [
    "exec",
    dbContainerName,
    "mysql",
    `-u${dbUser}`,
    `-p${dbPassword}`,
    "-e",
    "SELECT 1;",
    dbName
  ]);

  if (result.code === 0) {
    return {
      key: "dbCredentials",
      label: "DB credentials",
      status: "pass" as const,
      message: "Database credentials worked for a simple SELECT test."
    };
  }

  return {
    key: "dbCredentials",
    label: "DB credentials",
    status: "fail" as const,
    message: result.stderr.trim() || result.stdout.trim() || "Database credential test failed."
  };
}

export async function validateSiteSetup(input: SiteSetupValidationInput) {
  const siteDirectory = clean(input.siteDirectory);
  const backupDestination = clean(input.backupDestination);
  const uploadsPath = clean(input.uploadsPath);
  const wordpressContainerName = clean(input.wordpressContainerName);
  const dbContainerName = clean(input.dbContainerName);
  const checks: SiteSetupCheck[] = [];

  checks.push(pathCheck("siteDirectory", "Site directory", siteDirectory, {
    missingMessage: "StackPress cannot see this folder. Make sure the parent folder is mounted into the StackPress container."
  }));

  const composePath = siteDirectory ? path.join(siteDirectory, "docker-compose.yml") : "";
  checks.push(pathCheck("composeFile", "docker-compose.yml", composePath));
  checks.push(pathCheck("uploadsPath", "Uploads path", uploadsPath));
  checks.push(pathCheck("backupDestination", "Backup destination", backupDestination, {
    writable: true,
    canCreate: true,
    missingMessage: "Folder does not exist. Create it?"
  }));

  checks.push(await containerCheck("wordpressContainer", "WordPress container", wordpressContainerName));
  checks.push(await containerCheck("dbContainer", "DB container", dbContainerName));
  checks.push(await databaseCredentialCheck(input));

  return {
    checks,
    canSave: !checks.some((check) => check.key === "siteDirectory" && check.status === "fail")
  };
}
