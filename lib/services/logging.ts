import fs from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { runtimeConfig } from "@/lib/config";
import { ensureDirectory } from "@/lib/filesystem";

export async function logActivity(
  scope: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
  meta?: Record<string, unknown>
) {
  ensureDirectory(runtimeConfig.logRoot);

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    meta
  });

  fs.appendFileSync(path.join(runtimeConfig.logRoot, "stackpress.log"), `${line}\n`);

  await prisma.activityLog.create({
    data: {
      level,
      scope,
      message,
      metaJson: meta ? JSON.stringify(meta) : null
    }
  });
}
