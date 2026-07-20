import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
export const CLOUD_CREDENTIAL_KEY_VERSION = 1;

type CredentialEnvelope = {
  version: number;
  algorithm: typeof ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function readKey(secretKey = process.env.STACKPRESS_SECRET_KEY) {
  if (!secretKey) {
    throw new Error("STACKPRESS_SECRET_KEY is required to store cloud credentials");
  }

  const key = Buffer.from(secretKey, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("STACKPRESS_SECRET_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function encryptCloudCredentials(
  credentials: Readonly<Record<string, unknown>>,
  secretKey?: string
) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, readKey(secretKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final()
  ]);

  const envelope: CredentialEnvelope = {
    version: CLOUD_CREDENTIAL_KEY_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };

  return JSON.stringify(envelope);
}

export function decryptCloudCredentials(
  encryptedCredentials: string,
  secretKey?: string
): Readonly<Record<string, unknown>> {
  const envelope = JSON.parse(encryptedCredentials) as CredentialEnvelope;
  if (envelope.version !== CLOUD_CREDENTIAL_KEY_VERSION || envelope.algorithm !== ALGORITHM) {
    throw new Error("Unsupported cloud credential envelope");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    readKey(secretKey),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);

  const value = JSON.parse(plaintext.toString("utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Cloud credential payload is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}
