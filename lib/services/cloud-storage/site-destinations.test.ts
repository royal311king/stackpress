import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SanitizedCloudConnection } from "./connections-types";
import {
  destinationAppliesToTrigger,
  saveSiteCloudDestinations,
  type SiteCloudDestinationInput,
  type SiteCloudDestinationRepository,
  validateAuthorizedDestinations
} from "./site-destinations";

function connection(id: string, overrides: Partial<SanitizedCloudConnection> = {}): SanitizedCloudConnection {
  return {
    id,
    provider: "google_drive",
    displayName: id,
    accountEmail: `${id}@example.com`,
    enabled: true,
    status: "connected",
    providerConfig: {},
    hasCredentials: true,
    usesCredentialReference: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastConnectedAt: null,
    lastTestedAt: null,
    lastSuccessfulTestAt: null,
    lastError: null,
    ...overrides
  };
}

class MemoryRepository implements SiteCloudDestinationRepository {
  values = new Map<string, SiteCloudDestinationInput[]>();
  async listConnectionIds(siteId: string) {
    return (this.values.get(siteId) ?? []).map((value) => value.cloudConnectionId);
  }
  async replace(siteId: string, inputs: readonly SiteCloudDestinationInput[]) {
    this.values.set(siteId, inputs.map((value) => ({ ...value })));
  }
}

describe("site cloud destination settings", () => {
  test("existing sites and new sites remain local-only when no destinations are saved", async () => {
    const repository = new MemoryRepository();
    await saveSiteCloudDestinations("site-1", [], [connection("drive-1")], repository);
    assert.deepEqual(repository.values.get("site-1"), []);
  });

  test("persists multiple accounts, folder settings, and trigger preferences", async () => {
    const repository = new MemoryRepository();
    await saveSiteCloudDestinations("site-1", [
      { cloudConnectionId: "drive-1", enabled: true, uploadScheduledBackups: true, uploadManualBackups: false, retentionPolicy: "delete_with_local", remoteFolderName: "Production" },
      { cloudConnectionId: "drive-2", enabled: true, uploadScheduledBackups: false, uploadManualBackups: true, retentionPolicy: "retain_remote", remoteFolderName: null }
    ], [connection("drive-1"), connection("drive-2")], repository);
    assert.equal(repository.values.get("site-1")?.length, 2);
    assert.equal(repository.values.get("site-1")?.[0].remoteFolderName, "Production");
    assert.equal(destinationAppliesToTrigger(repository.values.get("site-1")![0], "schedule"), true);
    assert.equal(destinationAppliesToTrigger(repository.values.get("site-1")![0], "manual"), false);
  });

  test("removing a destination only changes future site configuration", async () => {
    const repository = new MemoryRepository();
    repository.values.set("site-1", [{ cloudConnectionId: "drive-1", enabled: true, uploadScheduledBackups: true, uploadManualBackups: true, retentionPolicy: "retain_remote", remoteFolderName: null }]);
    await saveSiteCloudDestinations("site-1", [], [connection("drive-1")], repository);
    assert.deepEqual(repository.values.get("site-1"), []);
  });

  test("rejects unavailable or unauthorized connections", () => {
    assert.throws(
      () => validateAuthorizedDestinations([
        { cloudConnectionId: "unknown", enabled: true, uploadScheduledBackups: true, uploadManualBackups: true, retentionPolicy: "retain_remote", remoteFolderName: null }
      ], [connection("drive-1")]),
      /unavailable or you are not authorized/
    );
    assert.throws(
      () => validateAuthorizedDestinations([
        { cloudConnectionId: "drive-2", enabled: true, uploadScheduledBackups: true, uploadManualBackups: true, retentionPolicy: "retain_remote", remoteFolderName: null }
      ], [connection("drive-2", { status: "disabled", enabled: false })]),
      /disabled or disconnected/
    );
  });

  test("allows an existing disconnected selection to remain or be removed", () => {
    const input = { cloudConnectionId: "drive-1", enabled: true, uploadScheduledBackups: true, uploadManualBackups: true, retentionPolicy: "retain_remote" as const, remoteFolderName: null };
    assert.doesNotThrow(() => validateAuthorizedDestinations(
      [input],
      [connection("drive-1", { status: "error" })],
      new Set(["drive-1"])
    ));
  });
});
