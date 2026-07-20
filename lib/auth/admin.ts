import { timingSafeEqual } from "node:crypto";

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export class AdminAuthorizationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminAuthorizationError";
    this.status = status;
  }
}

/**
 * StackPress currently has no user/session system. Sensitive provider routes
 * use HTTP Basic credentials until a first-class administrator identity layer exists.
 */
export function requireStackPressAdmin(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env
) {
  const username = environment.STACKPRESS_ADMIN_USERNAME;
  const password = environment.STACKPRESS_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new AdminAuthorizationError(
      "Administrator authentication is not configured",
      503
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) {
    throw new AdminAuthorizationError("Administrator authentication required", 401);
  }

  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    throw new AdminAuthorizationError("Administrator authentication required", 401);
  }
  const separator = decoded.indexOf(":");
  const suppliedUsername = separator >= 0 ? decoded.slice(0, separator) : "";
  const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (!safeEqual(suppliedUsername, username) || !safeEqual(suppliedPassword, password)) {
    throw new AdminAuthorizationError("Administrator authentication required", 401);
  }
}
