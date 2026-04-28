import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

type ComposeVolume = string | { source?: string; target?: string };
type ComposePort = string | { published?: string | number; target?: string | number; mode?: string };
type ComposeService = {
  container_name?: string;
  image?: string;
  environment?: Record<string, unknown> | string[];
  env_file?: string | string[];
  volumes?: ComposeVolume[];
  ports?: ComposePort[];
};
type ComposeFile = { services?: Record<string, ComposeService> };

type ServiceCandidate = {
  name: string;
  config: ComposeService;
  environment: Record<string, string>;
};

export type ScannedWordPressSite = {
  folderName: string;
  name: string;
  slug: string;
  siteDirectory: string;
  uploadsPath: string;
  backupDestination: string;
  wordpressContainerName: string;
  dbContainerName: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  mappedHostPort: string | null;
  siteUrl: string;
  publicUrl: string;
  cloudflareServiceTarget: string;
  containerStatus: "running" | "stopped" | "unknown";
  needsReview: string[];
  warnings: string[];
  existingSiteId: string | null;
};

export const DEFAULT_SITES_ROOT = "/mnt/wp-sites";
export const DEFAULT_BACKUPS_ROOT = "/mnt/wp-backups";

function readEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) {
    return {} as Record<string, string>;
  }

  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      values[key] = value;
    }
  }
  return values;
}

function interpolateEnv(value: string, env: Record<string, string>) {
  return value.replace(/\$\{([^}:]+)(?:(:-|-)([^}]*))?\}/g, (_match, key: string, _mode: string | undefined, fallback: string | undefined) => env[key] ?? fallback ?? "");
}

function normalizeEnvironment(service: ComposeService, siteDirectory: string, baseEnv: Record<string, string>) {
  const envFiles = Array.isArray(service.env_file) ? service.env_file : service.env_file ? [service.env_file] : [];
  const mergedEnv = { ...baseEnv };

  for (const envFile of envFiles) {
    const envPath = path.isAbsolute(envFile) ? envFile : path.join(siteDirectory, envFile);
    Object.assign(mergedEnv, readEnvFile(envPath));
  }

  const environment: Record<string, string> = {};
  if (Array.isArray(service.environment)) {
    for (const entry of service.environment) {
      if (!entry) continue;
      if (!entry.includes("=")) {
        if (mergedEnv[entry]) environment[entry] = mergedEnv[entry];
        continue;
      }
      const [key, ...rawValue] = entry.split("=");
      environment[key] = interpolateEnv(rawValue.join("="), mergedEnv);
    }
  } else if (service.environment && typeof service.environment === "object") {
    for (const [key, rawValue] of Object.entries(service.environment)) {
      if (rawValue === undefined || rawValue === null) {
        if (mergedEnv[key]) environment[key] = mergedEnv[key];
        continue;
      }
      environment[key] = interpolateEnv(String(rawValue), mergedEnv);
    }
  }

  return environment;
}

function getVolumeTargets(service: ComposeService) {
  return (service.volumes ?? []).map((volume) => typeof volume === "string" ? volume.split(":")[1] ?? "" : volume.target ?? "");
}

function scoreWordPressService(candidate: ServiceCandidate) {
  let score = 0;
  const containerName = candidate.config.container_name?.toLowerCase() ?? "";
  const image = candidate.config.image?.toLowerCase() ?? "";
  const serviceName = candidate.name.toLowerCase();
  const volumeTargets = getVolumeTargets(candidate.config).join(" ").toLowerCase();
  if (containerName.startsWith("wp-")) score += 6;
  if (serviceName.includes("wordpress") || serviceName.includes("wp")) score += 3;
  if (image.includes("wordpress")) score += 8;
  if (candidate.environment.WORDPRESS_DB_HOST || candidate.environment.WORDPRESS_DB_NAME) score += 4;
  if (volumeTargets.includes("/var/www/html")) score += 3;
  return score;
}

function scoreDbService(candidate: ServiceCandidate) {
  let score = 0;
  const containerName = candidate.config.container_name?.toLowerCase() ?? "";
  const image = candidate.config.image?.toLowerCase() ?? "";
  const serviceName = candidate.name.toLowerCase();
  if (containerName.startsWith("wpdb-") || containerName.startsWith("db-")) score += 6;
  if (serviceName.includes("db") || serviceName.includes("mysql") || serviceName.includes("mariadb")) score += 3;
  if (image.includes("mysql") || image.includes("mariadb")) score += 8;
  if (candidate.environment.MYSQL_DATABASE || candidate.environment.MARIADB_DATABASE) score += 4;
  return score;
}

function getMappedHostPort(service?: ComposeService) {
  for (const port of service?.ports ?? []) {
    if (typeof port === "string") {
      const withoutProtocol = port.split("/")[0] ?? port;
      const parts = withoutProtocol.split(":");
      if (parts.length >= 2) {
        return parts.at(-2) || null;
      }
      continue;
    }

    if (port.published) {
      return String(port.published);
    }
  }
  return null;
}


function detectUploadsPath(siteDirectory: string) {
  const candidates = [
    path.join(siteDirectory, "html", "wp-content", "uploads"),
    path.join(DEFAULT_SITES_ROOT, path.basename(siteDirectory), "html", "wp-content", "uploads"),
    path.join(siteDirectory, "wp", "wp-content", "uploads")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function titleizeSlug(slug: string) {
  return slug.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function getContainerStatus(containerName: string) {
  if (!containerName) return "unknown" as const;
  try {
    const { runCommand } = await import("@/lib/shell");
    const result = await runCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerName]);
    if (result.code !== 0) return "unknown" as const;
    return result.stdout.trim() === "true" ? "running" as const : "stopped" as const;
  } catch {
    return "unknown" as const;
  }
}

async function scanSiteFolder(siteDirectory: string, existingBySlug: Map<string, string>) {
  const folderName = path.basename(siteDirectory);
  const slug = slugify(folderName);
  const composePath = path.join(siteDirectory, "docker-compose.yml");
  const raw = fs.readFileSync(composePath, "utf8");
  const parsed = yaml.load(raw) as ComposeFile | null;
  const services = parsed?.services ?? {};
  const baseEnv = { ...readEnvFile(path.join(siteDirectory, ".env")), SITE_SLUG: folderName };
  const candidates = Object.entries(services).map(([name, config]) => ({
    name,
    config,
    environment: normalizeEnvironment(config, siteDirectory, baseEnv)
  }));

  const wordpressEntry = [...candidates].sort((a, b) => scoreWordPressService(b) - scoreWordPressService(a))[0] ?? null;
  const dbEntry = [...candidates].sort((a, b) => scoreDbService(b) - scoreDbService(a))[0] ?? null;
  const warnings: string[] = [];
  const needsReview: string[] = [];

  const wordpressContainerName = wordpressEntry?.config.container_name ?? `wp-${slug}`;
  const dbContainerName = dbEntry?.config.container_name ?? `wpdb-${slug}`;
  if (!wordpressEntry?.config.container_name) warnings.push("WordPress container name was guessed from the folder name.");
  if (!dbEntry?.config.container_name) warnings.push("Database container name was guessed from the folder name.");

  const dbName = wordpressEntry?.environment.WORDPRESS_DB_NAME ?? dbEntry?.environment.MYSQL_DATABASE ?? dbEntry?.environment.MARIADB_DATABASE ?? "wpdb";
  const dbUser = wordpressEntry?.environment.WORDPRESS_DB_USER ?? dbEntry?.environment.MYSQL_USER ?? dbEntry?.environment.MARIADB_USER ?? "wpuser";
  const dbPassword = wordpressEntry?.environment.WORDPRESS_DB_PASSWORD ?? dbEntry?.environment.MYSQL_PASSWORD ?? dbEntry?.environment.MARIADB_PASSWORD ?? "";
  if (!dbPassword) needsReview.push("dbPassword");

  const mappedHostPort = getMappedHostPort(wordpressEntry?.config);
  const siteUrl = mappedHostPort ? `http://localhost:${mappedHostPort}` : "";
  const containerStatus = await getContainerStatus(wordpressContainerName);
  if (containerStatus === "stopped") warnings.push("WordPress container is detected but stopped.");
  if (containerStatus === "unknown") warnings.push("WordPress container status could not be confirmed.");

  return {
    folderName,
    name: titleizeSlug(slug),
    slug,
    siteDirectory,
    uploadsPath: detectUploadsPath(siteDirectory),
    backupDestination: path.join(DEFAULT_BACKUPS_ROOT, slug, "stackpress"),
    wordpressContainerName,
    dbContainerName,
    dbName,
    dbUser,
    dbPassword,
    mappedHostPort,
    siteUrl,
    publicUrl: "",
    cloudflareServiceTarget: "",
    containerStatus,
    needsReview,
    warnings,
    existingSiteId: existingBySlug.get(slug) ?? null
  } satisfies ScannedWordPressSite;
}

export async function scanWordPressSites(rootPath = process.env.STACKPRESS_SITES_ROOT || DEFAULT_SITES_ROOT) {
  if (!fs.existsSync(rootPath)) {
    throw new Error("Sites directory is not mounted.");
  }

  const existingSites = await prisma.site.findMany({ select: { id: true, slug: true } });
  const existingBySlug = new Map(existingSites.map((site) => [site.slug, site.id]));
  const folders = fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name))
    .filter((folder) => fs.existsSync(path.join(folder, "docker-compose.yml")))
    .sort();

  if (folders.length === 0) {
    throw new Error("No WordPress Docker sites found.");
  }

  const sites = await Promise.all(folders.map((folder) => scanSiteFolder(folder, existingBySlug)));
  return { rootPath, sites };
}
