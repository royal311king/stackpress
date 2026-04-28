import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { formatSiteValidationError, siteSchema } from "@/lib/validators";
import { slugify } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sites = Array.isArray(body.sites) ? body.sites : [];
    const overwriteExisting = Boolean(body.overwriteExisting);
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ slug: string; error: string }> = [];

    for (const rawSite of sites) {
      const slug = slugify(rawSite.slug || rawSite.name || rawSite.folderName);
      const existing = await prisma.site.findUnique({ where: { slug } });

      if (existing && !overwriteExisting) {
        skipped += 1;
        errors.push({ slug, error: "Already imported." });
        continue;
      }

      if (!rawSite.dbPassword) {
        skipped += 1;
        errors.push({ slug, error: "DB password needs review before import." });
        continue;
      }

      const parsed = siteSchema.parse({
        name: rawSite.name,
        slug,
        siteUrl: rawSite.publicUrl || rawSite.siteUrl || null,
        siteDirectory: rawSite.siteDirectory,
        backupDestination: rawSite.backupDestination,
        dbContainerName: rawSite.dbContainerName,
        dbName: rawSite.dbName || "wpdb",
        dbUser: rawSite.dbUser || "wpuser",
        dbPassword: rawSite.dbPassword,
        wordpressContainerName: rawSite.wordpressContainerName,
        uploadsPath: rawSite.uploadsPath,
        active: true,
        notes: [
          rawSite.cloudflareServiceTarget ? `Cloudflare service target: ${rawSite.cloudflareServiceTarget}` : null,
          rawSite.mappedHostPort ? `Detected mapped host port: ${rawSite.mappedHostPort}` : null
        ].filter(Boolean).join("\n") || null,
        backupFrequency: "manual",
        backupTime: "02:00",
        timezone: "America/Chicago",
        cronExpression: null,
        retentionCount: 10,
        retentionDays: null,
        neverDeleteNewest: true,
        backupMode: "full",
        scheduleEnabled: false
      });

      if (existing && overwriteExisting) {
        await prisma.site.update({ where: { id: existing.id }, data: parsed });
        updated += 1;
        await logActivity("site", `Auto-detected site updated: ${parsed.name}`, "info", { siteId: existing.id });
      } else {
        const created = await prisma.site.create({ data: parsed });
        imported += 1;
        await logActivity("site", `Auto-detected site imported: ${created.name}`, "info", { siteId: created.id });
      }
    }

    return NextResponse.json({ imported, updated, skipped, errors, message: `Imported ${imported + updated} WordPress sites into StackPress.` });
  } catch (error) {
    if (error instanceof ZodError) {
      const formatted = formatSiteValidationError(error);
      return NextResponse.json({ error: formatted.summary, fieldErrors: formatted.fieldErrors }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import detected sites" },
      { status: 400 }
    );
  }
}
