import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createGoogleOAuthState,
  GoogleOAuthFlowError,
  verifyGoogleOAuthState
} from "./google-oauth-state";

const SECRET_KEY = Buffer.alloc(32, 3).toString("base64");
const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("Google OAuth state", () => {
  test("round-trips signed state and reconnect connection ID", () => {
    const created = createGoogleOAuthState({
      connectionId: "connection-1",
      now: NOW,
      secretKey: SECRET_KEY
    });
    const verified = verifyGoogleOAuthState({
      cookieValue: created.cookieValue,
      returnedState: created.state,
      now: NOW,
      secretKey: SECRET_KEY
    });

    assert.equal(verified.connectionId, "connection-1");
    assert.equal(verified.nonce, created.state);
  });

  test("rejects invalid state to prevent CSRF", () => {
    const created = createGoogleOAuthState({ now: NOW, secretKey: SECRET_KEY });

    assert.throws(
      () => verifyGoogleOAuthState({
        cookieValue: created.cookieValue,
        returnedState: "attacker-state",
        now: NOW,
        secretKey: SECRET_KEY
      }),
      (error: unknown) => error instanceof GoogleOAuthFlowError && error.code === "invalid_state"
    );
  });

  test("rejects expired state", () => {
    const created = createGoogleOAuthState({ now: NOW, secretKey: SECRET_KEY });
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);

    assert.throws(
      () => verifyGoogleOAuthState({
        cookieValue: created.cookieValue,
        returnedState: created.state,
        now: later,
        secretKey: SECRET_KEY
      }),
      GoogleOAuthFlowError
    );
  });

  test("rejects malformed signing keys and signed payload shapes", () => {
    assert.throws(
      () => createGoogleOAuthState({ secretKey: Buffer.alloc(16).toString("base64") }),
      /32-byte key/
    );

    const created = createGoogleOAuthState({ now: NOW, secretKey: SECRET_KEY });
    const [payload, signature] = created.cookieValue.split(".");
    assert.ok(payload && signature);
    const malformedPayload = Buffer.from(JSON.stringify({ nonce: 1, connectionId: null, issuedAt: 1 })).toString("base64url");
    assert.throws(
      () => verifyGoogleOAuthState({
        cookieValue: `${malformedPayload}.${signature}`,
        returnedState: created.state,
        now: NOW,
        secretKey: SECRET_KEY
      }),
      GoogleOAuthFlowError
    );
  });
});
