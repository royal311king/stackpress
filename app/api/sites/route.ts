import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/logging";
import { siteSchema } from "@/lib/validators";
import { slugify } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = siteSchema.parse({
      ...body,
      slug: slugify(body.slug || body.name)
    });

    const site = await prisma.site.create({
      data: parsed
    });

    await logActivity("site", `Site created: ${site.name}`, "info", { siteId: site.id });

    return NextResponse.json({
      ok: true,
      redirectTo: `/sites/${site.id}`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create site" },
      { status: 400 }
    );
  }
}
