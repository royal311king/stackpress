import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "stackpress_google_oauth_state";
export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

type GoogleOAuthStatePayload = {
  nonce: string;
  connectionId: string | null;
  issuedAt: number;
};

function signingKey(secretKey = process.env.STACKPRESS_SECRET_KEY) {
  if (!secretKey) {
    throw new Error("STACKPRESS_SECRET_KEY is required for Google OAuth state validation");
  }
  const key = Buffer.from(secretKey, "base64");
  if (key.length !== 32) {
    throw new Error("STACKPRESS_SECRET_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function signature(encodedPayload: string, secretKey?: string) {
  return createHmac("sha256", signingKey(secretKey))
    .update(encodedPayload)
    .digest("base64url");
}

export function createGoogleOAuthState(options: {
  connectionId?: string | null;
  now?: Date;
  secretKey?: string;
} = {}) {
  const payload: GoogleOAuthStatePayload = {
    nonce: randomBytes(32).toString("base64url"),
    connectionId: options.connectionId ?? null,
    issuedAt: (options.now ?? new Date()).getTime()
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    state: payload.nonce,
    cookieValue: `${encodedPayload}.${signature(encodedPayload, options.secretKey)}`
  };
}

export function verifyGoogleOAuthState(options: {
  cookieValue?: string | null;
  returnedState?: string | null;
  now?: Date;
  secretKey?: string;
}) {
  if (!options.cookieValue || !options.returnedState) {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }
  const [encodedPayload, suppliedSignature] = options.cookieValue.split(".");
  if (!encodedPayload || !suppliedSignature) {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }
  const expectedSignature = signature(encodedPayload, options.secretKey);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }

  let payload: GoogleOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }
  if (
    !payload ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length < 32 ||
    (payload.connectionId !== null && typeof payload.connectionId !== "string") ||
    typeof payload.issuedAt !== "number" ||
    !Number.isFinite(payload.issuedAt)
  ) {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }
  const ageMs = (options.now ?? new Date()).getTime() - payload.issuedAt;
  if (
    payload.nonce !== options.returnedState ||
    ageMs < 0 ||
    ageMs > GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS * 1000
  ) {
    throw new GoogleOAuthFlowError("invalid_state", "Google OAuth state is missing or invalid");
  }
  return payload;
}

export type GoogleOAuthFlowErrorCode =
  | "invalid_state"
  | "access_denied"
  | "missing_code"
  | "missing_refresh_token"
  | "revoked_credentials"
  | "oauth_exchange_failed";

export class GoogleOAuthFlowError extends Error {
  readonly code: GoogleOAuthFlowErrorCode;

  constructor(code: GoogleOAuthFlowErrorCode, message: string) {
    super(message);
    this.name = "GoogleOAuthFlowError";
    this.code = code;
  }
}
