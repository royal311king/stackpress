import { prisma } from "@/lib/prisma";
import { normalizeSiteUrl } from "@/lib/site-url";
import { logActivity } from "@/lib/services/logging";

export async function checkSiteHealth(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) {
    throw new Error("Site not found");
  }

  const targetUrl = normalizeSiteUrl(site.siteUrl);
  if (!targetUrl) {
    const checkedAt = new Date();
    const updatedSite = await prisma.site.update({
      where: { id: siteId },
      data: {
        healthStatus: "unknown",
        healthStatusCode: null,
        healthResponseTimeMs: null,
        healthCheckedAt: checkedAt,
        healthError: "Site URL is not configured"
      }
    });

    await logActivity("health", `Health check skipped for ${site.name}: Site URL is not configured`, "warn", {
      siteId
    });

    return updatedSite;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const startedAt = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store"
    });
    const responseTimeMs = Date.now() - startedAt;
    const status = response.ok ? "online" : "down";

    const updatedSite = await prisma.site.update({
      where: { id: siteId },
      data: {
        healthStatus: status,
        healthStatusCode: response.status,
        healthResponseTimeMs: responseTimeMs,
        healthCheckedAt: new Date(),
        healthError: response.ok ? null : response.statusText || `HTTP ${response.status}`
      }
    });

    await logActivity("health", `Health check ${status} for ${site.name}`, response.ok ? "info" : "error", {
      siteId,
      siteUrl: targetUrl,
      statusCode: response.status,
      responseTimeMs
    });

    return updatedSite;
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Health check failed";

    const updatedSite = await prisma.site.update({
      where: { id: siteId },
      data: {
        healthStatus: "down",
        healthStatusCode: null,
        healthResponseTimeMs: responseTimeMs,
        healthCheckedAt: new Date(),
        healthError: message
      }
    });

    await logActivity("health", `Health check down for ${site.name}`, "error", {
      siteId,
      siteUrl: targetUrl,
      error: message,
      responseTimeMs
    });

    return updatedSite;
  } finally {
    clearTimeout(timeout);
  }
}
