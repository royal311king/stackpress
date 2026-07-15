import { prisma } from "@/lib/prisma";
import { runtimeConfig } from "@/lib/config";
import path from "node:path";

export async function getAppSettings() {
  const settings = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      defaultTimezone: runtimeConfig.timezone,
      backupRoot: runtimeConfig.storageRoot,
      sitesRoot: "/mnt/wp-sites",
      defaultBackupRoot: runtimeConfig.storageRoot,
      defaultLogRoot: runtimeConfig.logRoot
    }
  });

  return settings;
}

export async function migrateLegacySitePaths() {
  await getAppSettings();
  const sites = await prisma.site.findMany();

  for (const site of sites) {
    const legacySite = site.siteDirectory ? path.resolve(site.siteDirectory) : null;
    const legacyBackup = site.backupDestination ? path.resolve(site.backupDestination) : null;
    const legacyBackupFolder = legacyBackup && path.basename(legacyBackup) === "stackpress"
      ? path.dirname(legacyBackup)
      : legacyBackup;
    const legacySiteLooksDerived = legacySite && path.basename(legacySite) === site.slug;
    const legacyBackupLooksDerived = legacyBackupFolder && path.basename(legacyBackupFolder) === site.slug;

    await prisma.site.update({
      where: { id: site.id },
      data: {
        customSiteDirectory: site.customSiteDirectory ?? (legacySite && !legacySiteLooksDerived ? legacySite : null),
        customBackupDestination: site.customBackupDestination ?? (legacyBackupFolder && !legacyBackupLooksDerived ? path.join(legacyBackupFolder, site.slug) : null),
        siteDirectory: null,
        backupDestination: null
      }
    });
  }
}
