import path from "node:path";

type SitePathInput = {
  slug: string;
  customSiteDirectory?: string | null;
  customBackupDestination?: string | null;
};

type RootSettings = { sitesRoot: string; backupRoot: string };

export function resolveSiteDirectory(site: SitePathInput, settings: RootSettings) {
  return path.resolve(site.customSiteDirectory || path.join(settings.sitesRoot, site.slug));
}

export function resolveBackupFolder(site: SitePathInput, settings: RootSettings) {
  return path.resolve(site.customBackupDestination || path.join(settings.backupRoot, site.slug));
}

export function resolveStackPressBackupDirectory(site: SitePathInput, settings: RootSettings) {
  return path.join(resolveBackupFolder(site, settings), "stackpress");
}

export function resolvePreRestoreDirectory(site: SitePathInput, settings: RootSettings) {
  return path.join(resolveStackPressBackupDirectory(site, settings), "pre-restore");
}
