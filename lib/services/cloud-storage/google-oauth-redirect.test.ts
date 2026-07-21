import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { googleOAuthCompletionUrl } from "./google-oauth-redirect";

describe("Google OAuth completion redirects", () => {
  test("uses STACKPRESS_APP_URL as the production origin and normalizes a trailing slash", () => {
    const previousAppUrl = process.env.STACKPRESS_APP_URL;
    process.env.STACKPRESS_APP_URL = "https://stackpress.gunthersnaps.com/";
    try {
      assert.equal(
        googleOAuthCompletionUrl("connected").toString(),
        "https://stackpress.gunthersnaps.com/settings/backups/cloud-providers?google=connected"
      );
    } finally {
      if (previousAppUrl === undefined) delete process.env.STACKPRESS_APP_URL;
      else process.env.STACKPRESS_APP_URL = previousAppUrl;
    }
  });

  test("never exposes an internal request origin", () => {
    const redirect = googleOAuthCompletionUrl(
      "connected",
      undefined,
      "https://stackpress.gunthersnaps.com"
    ).toString();

    assert.equal(redirect.includes("0.0.0.0"), false);
    assert.equal(redirect.includes("localhost"), false);
  });

  test("supports explicitly configured localhost development", () => {
    assert.equal(
      googleOAuthCompletionUrl("connected", undefined, "http://localhost:3000/").toString(),
      "http://localhost:3000/settings/backups/cloud-providers?google=connected"
    );
  });

  test("success, cancellation, and error redirects share the canonical origin", () => {
    const appUrl = "https://stackpress.gunthersnaps.com/";
    assert.equal(
      googleOAuthCompletionUrl("connected", undefined, appUrl).toString(),
      "https://stackpress.gunthersnaps.com/settings/backups/cloud-providers?google=connected"
    );
    assert.equal(
      googleOAuthCompletionUrl("cancelled", undefined, appUrl).toString(),
      "https://stackpress.gunthersnaps.com/settings/backups/cloud-providers?google=cancelled"
    );
    assert.equal(
      googleOAuthCompletionUrl("error", "missing_code", appUrl).toString(),
      "https://stackpress.gunthersnaps.com/settings/backups/cloud-providers?google=error&reason=missing_code"
    );
  });
});
