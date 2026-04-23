import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export type DetectionResult = {
  siteName: string;
  slug: string;
  wordpressContainerName: string;
  dbContainerName: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  uploadsPath: string;
};

export async function detectSiteFromCompose(siteDirectory: string): Promise<DetectionResult | null> {
  const composePath = path.join(siteDirectory, "docker-compose.yml");
  if (!fs.existsSync(composePath)) {
    return null;
  }

  const raw = fs.readFileSync(composePath, "utf8");
  const parsed = yaml.load(raw) as {
    services?: Record<string, { container_name?: string; environment?: Record<string, string> }>;
  };

  const services = parsed?.services ?? {};
  const wordpressEntry =
    Object.values(services).find((service) => service.container_name?.includes("wp-")) ??
    Object.values(services)[0];
  const dbEntry =
    Object.values(services).find((service) => service.container_name?.includes("wpdb-")) ??
    Object.values(services)[1];

  const slug = path.basename(siteDirectory);

  return {
    siteName: slug.replace(/-/g, " "),
    slug,
    wordpressContainerName: wordpressEntry?.container_name ?? `wp-${slug}`,
    dbContainerName: dbEntry?.container_name ?? `wpdb-${slug}`,
    dbName: dbEntry?.environment?.MYSQL_DATABASE ?? "wpdb",
    dbUser: dbEntry?.environment?.MYSQL_USER ?? "wpuser",
    dbPassword: dbEntry?.environment?.MYSQL_PASSWORD ?? "wppass123",
    uploadsPath: path.join(siteDirectory, "html", "wp-content", "uploads")
  };
}
