import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CloudStorageProvider } from "./provider";
import { CloudProviderError } from "./types";
import {
  createCloudConnectionService,
  sanitizeCloudConnection
} from "./connections";
import type {
  CloudConnectionRecord,
  CloudConnectionRepository,
  CreateCloudConnectionRecord,
  UpdateCloudConnectionRecord
} from "./connections-repository";

const SECRET_KEY = Buffer.alloc(32, 9).toString("base64");
const NOW = new Date("2026-07-15T12:00:00.000Z");

class MemoryCloudConnectionRepository implements CloudConnectionRepository {
  records = new Map<string, CloudConnectionRecord>();
  deletedIds: string[] = [];
  nextId = 1;

  async create(data: CreateCloudConnectionRecord) {
    const record: CloudConnectionRecord = {
      id: `connection-${this.nextId++}`,
      ...data,
      createdAt: NOW,
      updatedAt: NOW,
      lastConnectedAt: null,
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastError: null
    };
    this.records.set(record.id, record);
    return record;
  }

  async findById(id: string) {
    return this.records.get(id) ?? null;
  }

  async findMany() {
    return [...this.records.values()];
  }

  async update(id: string, data: UpdateCloudConnectionRecord) {
    const current = this.records.get(id);
    if (!current) throw new Error("not found");
    const updated = { ...current, ...data, updatedAt: NOW };
    this.records.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.deletedIds.push(id);
    this.records.delete(id);
  }
}

function connectedProvider(): CloudStorageProvider {
  return {
    async testConnection() {
      return {
        ok: true,
        message: "Connected to Google Drive",
        checkedAt: NOW.toISOString(),
        accountLabel: "admin@example.com"
      };
    },
    async uploadBackup() { throw new Error("not used"); },
    async downloadBackup() { throw new Error("not used"); },
    async deleteBackup() { throw new Error("not used"); },
    async verifyBackupExists() { throw new Error("not used"); },
    async listRemoteBackups() { throw new Error("not used"); }
  };
}

describe("cloud connection service", () => {
  test("supports multiple accounts for the same provider", async () => {
    const repository = new MemoryCloudConnectionRepository();
    const service = createCloudConnectionService({ repository, secretKey: SECRET_KEY });

    await service.create({ provider: "google_drive", displayName: "Personal Drive" });
    await service.create({ provider: "google_drive", displayName: "Company Drive" });

    const connections = await service.list();
    assert.equal(connections.length, 2);
    assert.deepEqual(connections.map((entry) => entry.displayName), ["Personal Drive", "Company Drive"]);
  });

  test("stores encrypted OAuth tokens and returns only sanitized connection data", async () => {
    const repository = new MemoryCloudConnectionRepository();
    const service = createCloudConnectionService({ repository, secretKey: SECRET_KEY });
    const response = await service.create({
      provider: "google_drive",
      displayName: "Primary Drive",
      accountEmail: "admin@example.com",
      providerConfig: { rootFolderId: "folder-1" },
      credentials: {
        accessToken: "access-token",
        refreshToken: "refresh-token"
      }
    });

    const stored = repository.records.get(response.id);
    assert.ok(stored?.encryptedCredentials);
    assert.equal(stored.encryptedCredentials.includes("refresh-token"), false);
    assert.equal(response.hasCredentials, true);
    assert.equal("encryptedCredentials" in response, false);
    assert.equal("credentialReference" in response, false);
    assert.equal(JSON.stringify(response).includes("refresh-token"), false);
    assert.deepEqual(response.providerConfig, { rootFolderId: "folder-1" });
  });

  test("rejects Google passwords", async () => {
    const repository = new MemoryCloudConnectionRepository();
    const service = createCloudConnectionService({ repository, secretKey: SECRET_KEY });

    await assert.rejects(
      service.create({
        provider: "google_drive",
        displayName: "Invalid Drive",
        credentials: { password: "never-store-this" }
      }),
      /Google passwords must never be stored/
    );
    assert.equal(repository.records.size, 0);
  });

  test("enables, disables, reconnects, and removes a connection without backup operations", async () => {
    const repository = new MemoryCloudConnectionRepository();
    const service = createCloudConnectionService({ repository, secretKey: SECRET_KEY });
    const created = await service.create({ provider: "google_drive", displayName: "Drive" });

    assert.equal((await service.disable(created.id)).status, "disabled");
    assert.equal((await service.enable(created.id)).status, "pending");
    const reconnected = await service.reconnect(created.id, {
      credentials: { refreshToken: "new-refresh-token" }
    });
    assert.equal(reconnected.enabled, true);
    assert.equal(reconnected.status, "pending");
    assert.equal(reconnected.hasCredentials, true);

    await service.remove(created.id);
    assert.deepEqual(repository.deletedIds, [created.id]);
    assert.equal(repository.records.size, 0);
  });

  test("tests a connection with decrypted server-only credentials and records success", async () => {
    const repository = new MemoryCloudConnectionRepository();
    let receivedRefreshToken: unknown;
    const service = createCloudConnectionService({
      repository,
      secretKey: SECRET_KEY,
      now: () => NOW,
      createProvider(context) {
        receivedRefreshToken = context.credentials.refreshToken;
        return connectedProvider();
      }
    });
    const created = await service.create({
      provider: "google_drive",
      displayName: "Drive",
      credentials: { refreshToken: "server-only-refresh-token" }
    });

    const tested = await service.test(created.id);

    assert.equal(receivedRefreshToken, "server-only-refresh-token");
    assert.equal(tested.connection.status, "connected");
    assert.equal(tested.connection.lastConnectedAt, NOW.toISOString());
    assert.equal(tested.connection.lastTestedAt, NOW.toISOString());
    assert.equal(tested.connection.lastSuccessfulTestAt, NOW.toISOString());
    assert.equal(JSON.stringify(tested).includes("server-only-refresh-token"), false);
  });

  test("redacts tokens from connection test errors and thrown service errors", async () => {
    const repository = new MemoryCloudConnectionRepository();
    const service = createCloudConnectionService({
      repository,
      secretKey: SECRET_KEY,
      now: () => NOW,
      createProvider() {
        return {
          ...connectedProvider(),
          async testConnection() {
            throw new CloudProviderError({
              providerType: "google_drive",
              code: "authentication_failed",
              message: "Rejected secret-refresh-token"
            });
          }
        };
      }
    });
    const created = await service.create({
      provider: "google_drive",
      displayName: "Drive",
      credentials: { refreshToken: "secret-refresh-token" }
    });

    await assert.rejects(
      service.test(created.id),
      (error: unknown) =>
        error instanceof CloudProviderError &&
        error.message === "Rejected [redacted]"
    );
    const stored = repository.records.get(created.id);
    assert.equal(stored?.lastError, "Rejected [redacted]");
  });

  test("sanitization never returns encrypted credentials or token references", () => {
    const record: CloudConnectionRecord = {
      id: "connection-1",
      provider: "google_drive",
      displayName: "Drive",
      accountEmail: null,
      enabled: true,
      status: "pending",
      encryptedCredentials: "encrypted-secret",
      credentialReference: "keychain://cloud/1",
      credentialKeyVersion: 1,
      providerConfigJson: "{}",
      createdAt: NOW,
      updatedAt: NOW,
      lastConnectedAt: null,
      lastTestedAt: null,
      lastSuccessfulTestAt: null,
      lastError: null
    };

    const sanitized = sanitizeCloudConnection(record);
    assert.equal(sanitized.hasCredentials, true);
    assert.equal(sanitized.usesCredentialReference, true);
    assert.equal(JSON.stringify(sanitized).includes("encrypted-secret"), false);
    assert.equal(JSON.stringify(sanitized).includes("keychain://cloud/1"), false);
  });
});
