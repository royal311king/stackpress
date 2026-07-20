import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AdminAuthorizationError,
  requireStackPressAdmin
} from "./admin";

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  STACKPRESS_ADMIN_USERNAME: "admin",
  STACKPRESS_ADMIN_PASSWORD: "admin-password"
};

describe("StackPress administrator route guard", () => {
  test("accepts configured HTTP Basic administrator credentials", () => {
    const authorization = Buffer.from("admin:admin-password").toString("base64");
    const request = new Request("http://localhost/api/cloud-storage/google/start", {
      headers: { authorization: `Basic ${authorization}` }
    });

    assert.doesNotThrow(() => requireStackPressAdmin(request, environment));
  });

  test("rejects missing or incorrect administrator credentials", () => {
    assert.throws(
      () => requireStackPressAdmin(
        new Request("http://localhost/api/cloud-storage/google/start"),
        environment
      ),
      (error: unknown) => error instanceof AdminAuthorizationError && error.status === 401
    );
  });

  test("fails closed when administrator authentication is not configured", () => {
    assert.throws(
      () => requireStackPressAdmin(
        new Request("http://localhost/api/cloud-storage/google/start"),
        { NODE_ENV: "test" }
      ),
      (error: unknown) => error instanceof AdminAuthorizationError && error.status === 503
    );
  });
});
