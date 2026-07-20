import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  decryptCloudCredentials,
  encryptCloudCredentials
} from "./credentials";

const SECRET_KEY = Buffer.alloc(32, 7).toString("base64");

describe("cloud credential encryption", () => {
  test("encrypts and decrypts OAuth tokens without plaintext token storage", () => {
    const credentials = {
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      expiresAt: "2026-07-15T12:00:00.000Z"
    };

    const encrypted = encryptCloudCredentials(credentials, SECRET_KEY);

    assert.equal(encrypted.includes("access-token-value"), false);
    assert.equal(encrypted.includes("refresh-token-value"), false);
    assert.deepEqual(decryptCloudCredentials(encrypted, SECRET_KEY), credentials);
  });

  test("rejects an invalid key length", () => {
    assert.throws(
      () => encryptCloudCredentials({ refreshToken: "secret" }, "not-a-valid-key"),
      /base64-encoded 32-byte key/
    );
  });

  test("detects ciphertext tampering", () => {
    const encrypted = encryptCloudCredentials({ refreshToken: "secret" }, SECRET_KEY);
    const envelope = JSON.parse(encrypted) as { ciphertext: string };
    envelope.ciphertext = Buffer.from("tampered").toString("base64");

    assert.throws(() => decryptCloudCredentials(JSON.stringify(envelope), SECRET_KEY));
  });
});
