import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type ComposeVolume = string | { source?: string; target?: string; type?: string };

type ComposeService = {
  container_name?: string;
  image?: string;
  environment?: Record<string, unknown> | string[];
  env_file?: string | string[];
  volumes?: ComposeVolume[];
};

type ComposeFile = {
  services?: Record<string, ComposeService>;
};

type ServiceCandidate = {
  name: string;
  config: ComposeService;
  environment: Record<string, string>;
};

export type DetectedVolumeMount = {
  service: string;
  source: string;
  target: string;
  type: "bind" | "volume" | "unknown";
};

export type DetectionFallbackGuess = {
  field: string;
  value: string;
  reason: string;
};

export type DetectionResult = {
  siteName: string;
  slug: string;
  siteDirectory: string;
  composePath: string;
  wordpressContainerName: string;
  dbContainerName: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  uploadsPath: string;
  suggestedBackupDestination: string | null;
  volumeMounts: DetectedVolumeMount[];
  fallbackGuesses: DetectionFallbackGuess[];
  warnings: string[];
  detectedFields: string[];
};

type DetectionInput = string | {
  siteDirectory?: string;
  composePath?: string;
};

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wordpress-site"
  );
}

function titleizeSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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
    const value = rawValue.join("=").trim().replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function interpolateEnv(value: string, env: Record<string, string>) {
  return value.replace(/\$\{([^}:]+)(?:(:-|-)([^}]*))?\}/g, (_match, key: string, _mode: string | undefined, fallback: string | undefined) => {
    return env[key] ?? fallback ?? "";
  });
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
      if (!entry) {
        continue;
      }

      if (!entry.includes("=")) {
        if (mergedEnv[entry]) {
          environment[entry] = mergedEnv[entry];
        }
        continue;
      }

      const [key, ...rawValue] = entry.split("=");
      environment[key] = interpolateEnv(rawValue.join("="), mergedEnv);
    }
  } else if (service.environment && typeof service.environment === "object") {
    for (const [key, rawValue] of Object.entries(service.environment)) {
      if (rawValue === undefined || rawValue === null) {
        if (mergedEnv[key]) {
          environment[key] = mergedEnv[key];
        }
        continue;
      }

      environment[key] = interpolateEnv(String(rawValue), mergedEnv);
    }
  }

  return environment;
}

function parseVolumeMount(serviceName: string, siteDirectory: string, volume: ComposeVolume): DetectedVolumeMount | null {
  if (typeof volume === "string") {
    const parts = volume.split(":");
    if (parts.length < 2) {
      return null;
    }

    const source = parts[0] ?? "";
    const target = parts[1] ?? "";
    if (!target) {
      return null;
    }

    const resolvedSource = source.startsWith(".") ? path.resolve(siteDirectory, source) : source;
    return {
      service: serviceName,
      source: resolvedSource,
      target,
      type: path.isAbsolute(resolvedSource) ? "bind" : "volume"
    };
  }

  if (!volume.target) {
    return null;
  }

  const rawSource = volume.source ?? "";
  const source = rawSource.startsWith(".") ? path.resolve(siteDirectory, rawSource) : rawSource;
  return {
    service: serviceName,
    source,
    target: volume.target,
    type: volume.type === "bind" || path.isAbsolute(source) ? "bind" : volume.type === "volume" ? "volume" : "unknown"
  };
}

function getVolumeTargets(service: ComposeService) {
  return (service.volumes ?? []).map((volume) => {
    if (typeof volume === "string") {
      const parts = volume.split(":");
      return parts[1] ?? parts[0] ?? "";
    }

    return volume.target ?? "";
  });
}

function scoreWordPressService(candidate: ServiceCandidate) {
  let score = 0;
  const containerName = candidate.config.container_name?.toLowerCase() ?? "";
  const image = candidate.config.image?.toLowerCase() ?? "";
  const serviceName = candidate.name.toLowerCase();
  const volumeTargets = getVolumeTargets(candidate.config).join(" ").toLowerCase();

  if (containerName.includes("wp-")) score += 5;
  if (serviceName === "wordpress" || serviceName.includes("wp")) score += 3;
  if (image.includes("wordpress")) score += 5;
  if (candidate.environment.WORDPRESS_DB_HOST || candidate.environment.WORDPRESS_DB_NAME) score += 4;
  if (volumeTargets.includes("/var/www/html") || volumeTargets.includes("html")) score += 2;

  return score;
}

function scoreDbService(candidate: ServiceCandidate) {
  let score = 0;
  const containerName = candidate.config.container_name?.toLowerCase() ?? "";
  const image = candidate.config.image?.toLowerCase() ?? "";
  const serviceName = candidate.name.toLowerCase();
  const volumeTargets = getVolumeTargets(candidate.config).join(" ").toLowerCase();

  if (containerName.includes("wpdb-") || containerName.includes("db")) score += 5;
  if (serviceName.includes("db") || serviceName.includes("mysql") || serviceName.includes("mariadb")) score += 3;
  if (image.includes("mysql") || image.includes("mariadb")) score += 5;
  if (candidate.environment.MYSQL_DATABASE || candidate.environment.MARIADB_DATABASE) score += 4;
  if (volumeTargets.includes("/var/lib/mysql") || volumeTargets.includes("db")) score += 2;

  return score;
}

function detectUploadsPath(siteDirectory: string) {
  return path.join(siteDirectory, "html", "wp-content", "uploads");
}

function resolveDetectionPaths(input: DetectionInput) {
  if (typeof input === "string") {
    return {
      siteDirectory: input,
      composePath: path.join(input, "docker-compose.yml")
    };
  }

  if (input.composePath) {
    return {
      siteDirectory: input.siteDirectory || path.dirname(input.composePath),
      composePath: input.composePath
    };
  }

  const siteDirectory = input.siteDirectory || "";
  return {
    siteDirectory,
    composePath: path.join(siteDirectory, "docker-compose.yml")
  };
}

function getSuggestedBackupDestination(slug: string) {
  const configuredRoot = process.env.STACKPRESS_BACKUP_ROOT || process.env.STACKPRESS_STORAGE_ROOT;
  if (configuredRoot) {
    return path.join(configuredRoot, slug);
  }

  if (fs.existsSync("/mnt/wp-backups")) {
    return path.join("/mnt/wp-backups", slug);
  }

  return null;
}

function pushFallback(fallbacks: DetectionFallbackGuess[], warnings: string[], field: string, value: string, reason: string) {
  fallbacks.push({ field, value, reason });
  warnings.push(`${reason} StackPress used ${value} as a fallback guess.`);
}

export async function detectSiteFromCompose(input: DetectionInput): Promise<DetectionResult | null> {
  const { siteDirectory, composePath } = resolveDetectionPaths(input);
  if (!siteDirectory || !fs.existsSync(composePath)) {
    return null;
  }

  const raw = fs.readFileSync(composePath, "utf8");
  const parsed = yaml.load(raw) as ComposeFile | null;
  const services = parsed?.services ?? {};
  const baseEnv = {
    ...readEnvFile(path.join(siteDirectory, ".env")),
    SITE_SLUG: path.basename(siteDirectory)
  };

  const serviceCandidates = Object.entries(services).map(([name, config]) => ({
    name,
    config,
    environment: normalizeEnvironment(config, siteDirectory, baseEnv)
  }));

  const volumeMounts = serviceCandidates.flatMap((candidate) => {
    return (candidate.config.volumes ?? [])
      .map((volume) => parseVolumeMount(candidate.name, siteDirectory, volume))
      .filter((mount): mount is DetectedVolumeMount => Boolean(mount));
  });

  const wordpressEntry =
    [...serviceCandidates].sort((a, b) => scoreWordPressService(b) - scoreWordPressService(a))[0] ?? null;
  const dbEntry =
    [...serviceCandidates].sort((a, b) => scoreDbService(b) - scoreDbService(a))[0] ?? null;

  const slug = slugify(path.basename(siteDirectory));
  const warnings: string[] = [];
  const fallbackGuesses: DetectionFallbackGuess[] = [];
  const detectedFields = ["siteDirectory", "slug", "uploadsPath"];

  const wordpressContainerName = wordpressEntry?.config.container_name ?? `wp-${slug}`;
  if (wordpressEntry?.config.container_name) {
    detectedFields.push("wordpressContainerName");
  } else {
    pushFallback(fallbackGuesses, warnings, "wordpressContainerName", wordpressContainerName, "WordPress container name was not found in docker-compose.yml.");
  }

  const dbContainerName = dbEntry?.config.container_name ?? `wpdb-${slug}`;
  if (dbEntry?.config.container_name) {
    detectedFields.push("dbContainerName");
  } else {
    pushFallback(fallbackGuesses, warnings, "dbContainerName", dbContainerName, "Database container name was not found in docker-compose.yml.");
  }

  const dbName = dbEntry?.environment.MYSQL_DATABASE ?? dbEntry?.environment.MARIADB_DATABASE ?? dbEntry?.environment.WORDPRESS_DB_NAME ?? "wpdb";
  if (dbEntry?.environment.MYSQL_DATABASE || dbEntry?.environment.MARIADB_DATABASE || dbEntry?.environment.WORDPRESS_DB_NAME) {
    detectedFields.push("dbName");
  } else {
    pushFallback(fallbackGuesses, warnings, "dbName", dbName, "Database name was not found in compose environment.");
  }

  const dbUser = dbEntry?.environment.MYSQL_USER ?? dbEntry?.environment.MARIADB_USER ?? wordpressEntry?.environment.WORDPRESS_DB_USER ?? "wpuser";
  if (dbEntry?.environment.MYSQL_USER || dbEntry?.environment.MARIADB_USER || wordpressEntry?.environment.WORDPRESS_DB_USER) {
    detectedFields.push("dbUser");
  } else {
    pushFallback(fallbackGuesses, warnings, "dbUser", dbUser, "Database user was not found in compose environment.");
  }

  const dbPassword = dbEntry?.environment.MYSQL_PASSWORD ?? dbEntry?.environment.MARIADB_PASSWORD ?? wordpressEntry?.environment.WORDPRESS_DB_PASSWORD ?? "wppass123";
  if (dbEntry?.environment.MYSQL_PASSWORD || dbEntry?.environment.MARIADB_PASSWORD || wordpressEntry?.environment.WORDPRESS_DB_PASSWORD) {
    detectedFields.push("dbPassword");
  } else {
    fallbackGuesses.push({ field: "dbPassword", value: "wppass123", reason: "Database password was not found in compose environment." });
    warnings.push("Database password was not found in compose environment. StackPress used the homelab default as a fallback guess.");
  }

  if (!wordpressEntry) {
    warnings.push("No clear WordPress service was identified in docker-compose.yml. Check the detected WordPress container name before saving.");
  }

  if (!dbEntry) {
    warnings.push("No clear database service was identified in docker-compose.yml. Check the detected database container name and credentials before saving.");
  }

  const uploadsPath = detectUploadsPath(siteDirectory);
  if (!fs.existsSync(path.join(siteDirectory, "html"))) {
    warnings.push("The site directory does not currently contain an html folder, so file backup paths should be double-checked.");
  }

  return {
    siteName: titleizeSlug(slug),
    slug,
    siteDirectory,
    composePath,
    wordpressContainerName,
    dbContainerName,
    dbName,
    dbUser,
    dbPassword,
    uploadsPath,
    suggestedBackupDestination: getSuggestedBackupDestination(slug),
    volumeMounts,
    fallbackGuesses,
    warnings,
    detectedFields
  };
}
