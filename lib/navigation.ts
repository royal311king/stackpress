export const CLOUD_BACKUPS_PATH = "/settings/backups/cloud-providers";

export const settingsNavigationItems = [
  { href: "/settings", label: "General" },
  { href: CLOUD_BACKUPS_PATH, label: "Backups · Cloud Providers" }
] as const;

export const sidebarNavigationItems = [
  { href: "/", label: "Dashboard", icon: "dashboard", matchSubpaths: false },
  { href: "/sites", label: "Sites", icon: "sites", matchSubpaths: true },
  { href: "/backups", label: "Backups", icon: "backups", matchSubpaths: true },
  { href: "/settings", label: "Settings", icon: "settings", matchSubpaths: false },
  { href: CLOUD_BACKUPS_PATH, label: "Cloud Backups", icon: "cloud-backups", matchSubpaths: true },
  { href: "/logs", label: "Logs", icon: "logs", matchSubpaths: true }
] as const;

export type SidebarNavigationItem = (typeof sidebarNavigationItems)[number];

export function isSidebarItemActive(pathname: string, item: SidebarNavigationItem) {
  return pathname === item.href || (item.matchSubpaths && pathname.startsWith(`${item.href}/`));
}
