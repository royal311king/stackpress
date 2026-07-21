import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";

import { createGoogleOAuthCallbackHandler } from "@/app/api/cloud-storage/google/callback/route";
import {
  createGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE
} from "./google-oauth-state";

const SECRET_KEY = Buffer.alloc(32, 8).toString("base64");
const PUBLIC_ORIGIN = "https://stackpress.gunthersnaps.com";
const previousAppUrl = process.env.STACKPRESS_APP_URL;
const previousSecretKey = process.env.STACKPRESS_SECRET_KEY;

function request(query: string) {
  const state = createGoogleOAuthState({ secretKey: SECRET_KEY });
  const separator = query ? "&" : "";
  return new NextRequest(`http://0.0.0.0:3000/api/cloud-storage/google/callback?${query}${separator}state=${state.state}`, {
    headers: { cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=${state.cookieValue}` }
  });
}

beforeEach(() => {
  process.env.STACKPRESS_APP_URL = `${PUBLIC_ORIGIN}/`;
  process.env.STACKPRESS_SECRET_KEY = SECRET_KEY;
});

afterEach(() => {
  if (previousAppUrl === undefined) delete process.env.STACKPRESS_APP_URL;
  else process.env.STACKPRESS_APP_URL = previousAppUrl;
  if (previousSecretKey === undefined) delete process.env.STACKPRESS_SECRET_KEY;
  else process.env.STACKPRESS_SECRET_KEY = previousSecretKey;
});

describe("Google OAuth callback canonical redirects", () => {
  test("success uses the public origin instead of the internal request origin", async () => {
    const handler = createGoogleOAuthCallbackHandler(async () => ({ id: "connection-1" }) as never);
    const response = await handler(request("code=authorization-code"));

    assert.equal(
      response.headers.get("location"),
      `${PUBLIC_ORIGIN}/settings/backups/cloud-providers?google=connected`
    );
    assert.equal(response.headers.get("location")?.includes("0.0.0.0"), false);
  });

  test("cancelled consent uses the public origin", async () => {
    const handler = createGoogleOAuthCallbackHandler(async () => ({ id: "unused" }) as never);
    const response = await handler(request("error=access_denied"));

    assert.equal(
      response.headers.get("location"),
      `${PUBLIC_ORIGIN}/settings/backups/cloud-providers?google=cancelled`
    );
  });

  test("callback errors use the public origin", async () => {
    const handler = createGoogleOAuthCallbackHandler(async () => ({ id: "unused" }) as never);
    const response = await handler(request(""));

    assert.equal(
      response.headers.get("location"),
      `${PUBLIC_ORIGIN}/settings/backups/cloud-providers?google=error&reason=missing_code`
    );
  });
});
