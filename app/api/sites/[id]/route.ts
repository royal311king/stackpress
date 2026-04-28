import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { formatSiteValidationError, siteSchema } from "@/lib/validators";
import { slugify } from "@/lib/utils";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = siteSchema.parse({
      ...body,
      slug: slugify(body.slug || body.name)
    });

    const site = await prisma.site.update({
      where: { id },
      data: parsed
    });

    await logActivity("site", `Site updated: ${site.name}`, "info", { siteId: site.id });

    return NextResponse.json({
      ok: true,
      redirectTo: `/sites/${site.id}`
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const formatted = formatSiteValidationError(error);
      return NextResponse.json(
        { error: formatted.summary, fieldErrors: formatted.fieldErrors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update site" },
      { status: 400 }
    );
  }
}
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });

    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    await prisma.site.delete({ where: { id } });
    await logActivity("site", `Site removed from StackPress: ${site.name}`, "warn", {
      siteId: site.id,
      slug: site.slug,
      filesDeleted: false,
      containersDeleted: false,
      backupFilesDeleted: false
    });

    return NextResponse.json({ ok: true, redirectTo: "/sites" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete site" },
      { status: 400 }
    );
  }
}
