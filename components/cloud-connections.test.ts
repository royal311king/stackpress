import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  cloudProviderListState,
  connectionStatusLabel,
  googleReconnectUrl,
  runCloudConnectionAction,
  type CloudProviderConnectionView
} from "./cloud-connections";

function connection(status: CloudProviderConnectionView["status"] = "connected"): CloudProviderConnectionView {
  return {
    id: "drive/account 1",
    provider: "google_drive",
    displayName: "Production Drive",
    accountEmail: "admin@example.com",
    enabled: status !== "disabled",
    status,
    providerConfig: {},
    hasCredentials: true,
    usesCredentialReference: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    lastConnectedAt: null,
    lastTestedAt: null,
    lastSuccessfulTestAt: null,
    lastError: null,
    siteCount: 2
  };
}

function jsonResponse(ok: boolean, body: Record<string, unknown>) {
  return {
    ok,
    async json() { return body; }
  } as Response;
}

describe("Cloud Providers settings frontend", () => {
  test("models loading-independent empty and populated states", () => {
    assert.equal(cloudProviderListState([]), "empty");
    assert.equal(cloudProviderListState([connection()]), "ready");
  });

  test("presents connected, testing, reauthorization, disabled, and error states", () => {
    assert.equal(connectionStatusLabel("connected"), "Connected");
    assert.equal(connectionStatusLabel("connected", "test"), "Testing");
    assert.equal(connectionStatusLabel("needs_reauthorization"), "Needs Reauthorization");
    assert.equal(connectionStatusLabel("disabled"), "Disabled");
    assert.equal(connectionStatusLabel("error"), "Error");
  });

  test("builds a safe reconnect action URL", () => {
    assert.equal(googleReconnectUrl(connection().id), "/api/cloud-storage/google/start?connectionId=drive%2Faccount%201");
  });

  test("test, disable, and disconnect actions call the expected protected endpoints", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push([String(input), init]);
      return jsonResponse(true, { ok: true });
    };
    await runCloudConnectionAction("drive-1", "test", request as typeof fetch);
    await runCloudConnectionAction("drive-1", "disable", request as typeof fetch);
    await runCloudConnectionAction("drive-1", "disconnect", request as typeof fetch);
    assert.deepEqual(calls.map(([url, init]) => [url, init?.method]), [
      ["/api/cloud-storage/connections/drive-1/test", "POST"],
      ["/api/cloud-storage/connections/drive-1/disable", "POST"],
      ["/api/cloud-storage/google/drive-1/disconnect", "POST"]
    ]);
  });

  test("surfaces backend action errors without exposing response internals", async () => {
    const request = async () => jsonResponse(false, { error: "Google authorization was revoked" });
    await assert.rejects(
      runCloudConnectionAction("drive-1", "test", request as typeof fetch),
      /Google authorization was revoked/
    );
  });
});
