import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  CLOUD_BACKUPS_PATH,
  isSidebarItemActive,
  settingsNavigationItems,
  sidebarNavigationItems
} from "../lib/navigation";

describe("cloud backup settings navigation", () => {
  test("the exact App Router page exists", () => {
    const routeFile = path.join(
      process.cwd(),
      "app/(dashboard)/settings/backups/cloud-providers/page.tsx"
    );

    assert.equal(CLOUD_BACKUPS_PATH, "/settings/backups/cloud-providers");
    assert.equal(existsSync(routeFile), true);
  });

  test("the General Settings page links to cloud providers", () => {
    const settingsPage = readFileSync(
      path.join(process.cwd(), "app/(dashboard)/settings/page.tsx"),
      "utf8"
    );

    assert.equal(settingsNavigationItems.some((item) => item.href === CLOUD_BACKUPS_PATH), true);
    assert.match(settingsPage, /href=\{CLOUD_BACKUPS_PATH\}/);
  });

  test("the sidebar links to cloud backups without also selecting General Settings", () => {
    const cloudItem = sidebarNavigationItems.find((item) => item.label === "Cloud Backups");
    const settingsItem = sidebarNavigationItems.find((item) => item.label === "Settings");

    assert.ok(cloudItem);
    assert.ok(settingsItem);
    assert.equal(cloudItem.href, CLOUD_BACKUPS_PATH);
    assert.equal(isSidebarItemActive(CLOUD_BACKUPS_PATH, cloudItem), true);
    assert.equal(isSidebarItemActive(CLOUD_BACKUPS_PATH, settingsItem), false);
  });
});
