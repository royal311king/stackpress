import { prisma } from "@/lib/prisma";
import { runtimeConfig } from "@/lib/config";

export async function getAppSettings() {
  const settings = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      defaultTimezone: runtimeConfig.timezone,
      defaultBackupRoot: runtimeConfig.storageRoot,
      defaultLogRoot: runtimeConfig.logRoot
    }
  });

  return settings;
}
