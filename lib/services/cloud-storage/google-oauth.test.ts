import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createCloudConnectionService } from "./connections";
import type {
  CloudConnectionRecord,
  CloudConnectionRepository,
  CreateCloudConnectionRecord,
  UpdateCloudConnectionRecord
} from "./connections-repository";
import {
  createGoogleOAuthService,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_USER_EMAIL_SCOPE,
  parseGoogleOAuthCallback,
  type GoogleOAuthClientLike
} from "./google-oauth";
import { GoogleOAuthFlowError } from "./google-oauth-state";
import { CloudProviderError } from "./types";

const SECRET_KEY = Buffer.alloc(32, 4).toString("base64");
const NOW = new Date("2026-07-15T12:00:00.000Z");

class MemoryRepository implements CloudConnectionRepository {
  records = new Map<string, CloudConnectionRecord>();
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
  async findById(id: string) { return this.records.get(id) ?? null; }
  async findMany() { return [...this.records.values()]; }
  async update(id: string, data: UpdateCloudConnectionRecord) {
    const current = this.records.get(id);
    if (!current) throw new Error("not found");
    const updated = { ...current, ...data, updatedAt: NOW };
    this.records.set(id, updated);
    return updated;
  }
  async delete(id: string) { this.records.delete(id); }
}

type ClientOptions = {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
  };
  accessTokenError?: Error;
};

function mockClient(options: ClientOptions = {}) {
  let authOptions: Record<string, unknown> | null = null;
  let credentials: Readonly<Record<string, unknown>> = {};
  let tokenListener: ((tokens: Readonly<Record<string, unknown>>) => void) | null = null;
  const client: GoogleOAuthClientLike = {
    generateAuthUrl(value) {
      authOptions = value;
      return "https://accounts.google.com/o/oauth2/v2/auth?state=test-state";
    },
    async getToken() {
      return { tokens: options.tokens ?? {} };
    },
    setCredentials(value) { credentials = value; },
    async getAccessToken() {
      if (options.accessTokenError) throw options.accessTokenError;
      return { token: "short-lived-access-token" };
    },
    on(_event, listener) {
      tokenListener = listener;
      return client;
    }
  };
  return {
    client,
    getAuthOptions: () => authOptions,
    getCredentials: () => credentials,
    emitTokens: (tokens: Readonly<Record<string, unknown>>) => tokenListener?.(tokens)
  };
}

describe("Google OAuth service", () => {
  test("starts offline OAuth with state and narrow Drive file scope", () => {
    const mock = mockClient();
    const service = createGoogleOAuthService({ createClient: () => mock.client });

    const url = service.authorizationUrl("csrf-state");
    const options = mock.getAuthOptions();

    assert.equal(url.startsWith("https://accounts.google.com/"), true);
    assert.equal(options?.state, "csrf-state");
    assert.equal(options?.access_type, "offline");
    assert.equal(options?.prompt, "consent select_account");
    assert.deepEqual(options?.scope, [GOOGLE_DRIVE_FILE_SCOPE, "openid", GOOGLE_USER_EMAIL_SCOPE]);
  });

  test("exchanges a callback, stores encrypted refresh token, and records account email", async () => {
    const repository = new MemoryRepository();
    const connections = createCloudConnectionService({ repository, secretKey: SECRET_KEY, now: () => NOW });
    const mock = mockClient({
      tokens: {
        access_token: "short-access-token",
        refresh_token: "long-refresh-token",
        expiry_date: NOW.getTime() + 3600000,
        scope: GOOGLE_DRIVE_FILE_SCOPE
      }
    });
    const service = createGoogleOAuthService({
      connections,
      createClient: () => mock.client,
      getAccountEmail: async () => "admin@example.com"
    });

    const connected = await service.handleCallback({ code: "authorization-code" });
    const stored = repository.records.get(connected.id);

    assert.equal(connected.accountEmail, "admin@example.com");
    assert.equal(connected.status, "connected");
    assert.ok(stored?.encryptedCredentials);
    assert.equal(stored.encryptedCredentials.includes("long-refresh-token"), false);
    assert.equal(JSON.stringify(connected).includes("long-refresh-token"), false);
    assert.equal(mock.getCredentials().refresh_token, "long-refresh-token");
  });

  test("handles denied consent", () => {
    assert.throws(
      () => parseGoogleOAuthCallback(new URLSearchParams("error=access_denied")),
      (error: unknown) => error instanceof GoogleOAuthFlowError && error.code === "access_denied"
    );
  });

  test("handles a missing authorization code", () => {
    assert.throws(
      () => parseGoogleOAuthCallback(new URLSearchParams()),
      (error: unknown) => error instanceof GoogleOAuthFlowError && error.code === "missing_code"
    );
  });

  test("does not create or replace a connection when Google omits the refresh token", async () => {
    const repository = new MemoryRepository();
    const connections = createCloudConnectionService({ repository, secretKey: SECRET_KEY, now: () => NOW });
    const mock = mockClient({ tokens: { access_token: "access-only" } });
    const service = createGoogleOAuthService({
      connections,
      createClient: () => mock.client,
      getAccountEmail: async () => "admin@example.com"
    });

    await assert.rejects(
      service.handleCallback({ code: "authorization-code" }),
      (error: unknown) => error instanceof GoogleOAuthFlowError && error.code === "missing_refresh_token"
    );
    assert.equal(repository.records.size, 0);
  });

  test("marks revoked credentials and requires reconnect", async () => {
    const repository = new MemoryRepository();
    const connections = createCloudConnectionService({ repository, secretKey: SECRET_KEY, now: () => NOW });
    const connected = await connections.completeOAuth({
      provider: "google_drive",
      displayName: "Google Drive",
      accountEmail: "admin@example.com",
      credentials: { refresh_token: "revoked-refresh-token" }
    });
    const mock = mockClient({ accessTokenError: new Error("invalid_grant") });
    const service = createGoogleOAuthService({ connections, createClient: () => mock.client });

    await assert.rejects(
      service.verifyCredentials(connected.id),
      (error: unknown) => error instanceof CloudProviderError && error.code === "authentication_failed"
    );
    const stored = repository.records.get(connected.id);
    assert.equal(stored?.status, "needs_reauthorization");
    assert.equal(stored?.lastError, "Google authorization expired or was revoked. Reconnect the account.");
  });

  test("persists automatically refreshed access tokens without exposing them", async () => {
    const repository = new MemoryRepository();
    const connections = createCloudConnectionService({ repository, secretKey: SECRET_KEY, now: () => NOW });
    const connected = await connections.completeOAuth({
      provider: "google_drive",
      displayName: "Google Drive",
      accountEmail: "admin@example.com",
      credentials: { refresh_token: "refresh-token", access_token: "old-access-token" }
    });
    const mock = mockClient();
    const service = createGoogleOAuthService({ connections, createClient: () => mock.client });

    await service.authorizedClient(connected.id);
    mock.emitTokens({ access_token: "new-access-token", expiry_date: NOW.getTime() + 3600000 });
    await new Promise((resolve) => setImmediate(resolve));

    const context = await connections.getProviderContext(connected.id);
    assert.equal(context.credentials.access_token, "new-access-token");
    assert.equal(context.credentials.refresh_token, "refresh-token");
    assert.equal(JSON.stringify(await connections.get(connected.id)).includes("new-access-token"), false);
  });
});
