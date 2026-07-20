import type { CloudProviderType } from "./types";

export const CLOUD_CONNECTION_STATUSES = [
  "pending",
  "connected",
  "needs_reauthorization",
  "error",
  "disabled"
] as const;

export type CloudConnectionStatus = (typeof CLOUD_CONNECTION_STATUSES)[number];

export type SanitizedCloudConnection = {
  id: string;
  provider: CloudProviderType;
  displayName: string;
  accountEmail: string | null;
  enabled: boolean;
  status: CloudConnectionStatus;
  providerConfig: Readonly<Record<string, unknown>>;
  hasCredentials: boolean;
  usesCredentialReference: boolean;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastTestedAt: string | null;
  lastSuccessfulTestAt: string | null;
  lastError: string | null;
};

type CredentialSource =
  | { credentials: Readonly<Record<string, unknown>>; credentialReference?: never }
  | { credentials?: never; credentialReference: string }
  | { credentials?: never; credentialReference?: never };

export type CreateCloudConnectionInput = CredentialSource & {
  provider: CloudProviderType;
  displayName: string;
  accountEmail?: string | null;
  enabled?: boolean;
  providerConfig?: Readonly<Record<string, unknown>>;
};

export type UpdateCloudConnectionInput = {
  displayName?: string;
  accountEmail?: string | null;
  providerConfig?: Readonly<Record<string, unknown>>;
};

export type ReconnectCloudConnectionInput = Exclude<CredentialSource, {
  credentials?: never;
  credentialReference?: never;
}>;
