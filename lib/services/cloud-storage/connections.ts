import {
  CLOUD_PROVIDER_TYPES,
  CloudProviderError,
  type CloudCredentials,
  type CloudProviderType
} from "./types";
import {
  CLOUD_CREDENTIAL_KEY_VERSION,
  decryptCloudCredentials,
  encryptCloudCredentials
} from "./credentials";
import {
  type CloudConnectionRecord,
  type CloudConnectionRepository,
  prismaCloudConnectionRepository
} from "./connections-repository";
import type {
  CloudConnectionStatus,
  CreateCloudConnectionInput,
  ReconnectCloudConnectionInput,
  SanitizedCloudConnection,
  UpdateCloudConnectionInput
} from "./connections-types";
import { createCloudStorageProvider } from "./registry";

type ProviderCreator = typeof createCloudStorageProvider;

type CloudConnectionServiceOptions = {
  repository?: CloudConnectionRepository;
  secretKey?: string;
  createProvider?: ProviderCreator;
  now?: () => Date;
};

function parseProvider(value: string): CloudProviderType {
  if (!CLOUD_PROVIDER_TYPES.includes(value as CloudProviderType)) {
    throw new Error(`Unsupported cloud provider: ${value}`);
  }
  return value as CloudProviderType;
}

function parseStatus(value: string): CloudConnectionStatus {
  if (value === "connected" || value === "needs_reauthorization" || value === "error" || value === "disabled") {
    return value;
  }
  return "pending";
}

function parseConfig(value: string) {
  try {
    const config = JSON.parse(value);
    return config && !Array.isArray(config) && typeof config === "object"
      ? config as Readonly<Record<string, unknown>>
      : {};
  } catch {
    return {};
  }
}

export function sanitizeCloudConnection(
  record: CloudConnectionRecord
): SanitizedCloudConnection {
  return {
    id: record.id,
    provider: parseProvider(record.provider),
    displayName: record.displayName,
    accountEmail: record.accountEmail,
    enabled: record.enabled,
    status: parseStatus(record.status),
    providerConfig: parseConfig(record.providerConfigJson),
    hasCredentials: Boolean(record.encryptedCredentials || record.credentialReference),
    usesCredentialReference: Boolean(record.credentialReference),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastConnectedAt: record.lastConnectedAt?.toISOString() ?? null,
    lastTestedAt: record.lastTestedAt?.toISOString() ?? null,
    lastSuccessfulTestAt: record.lastSuccessfulTestAt?.toISOString() ?? null,
    lastError: record.lastError
  };
}

export function createCloudConnectionService(options: CloudConnectionServiceOptions = {}) {
  const repository = options.repository ?? prismaCloudConnectionRepository;
  const createProvider = options.createProvider ?? createCloudStorageProvider;
  const now = options.now ?? (() => new Date());

  function assertCredentialPolicy(
    provider: CloudProviderType,
    credentials?: Readonly<Record<string, unknown>>
  ) {
    if (
      provider === "google_drive" &&
      credentials &&
      Object.keys(credentials).some((key) => key.toLowerCase().includes("password"))
    ) {
      throw new Error("Google passwords must never be stored; use OAuth tokens instead");
    }
  }

  function credentialFields(input: ReconnectCloudConnectionInput | CreateCloudConnectionInput) {
    if ("credentials" in input && input.credentials) {
      return {
        encryptedCredentials: encryptCloudCredentials(input.credentials, options.secretKey),
        credentialReference: null,
        credentialKeyVersion: CLOUD_CREDENTIAL_KEY_VERSION
      };
    }
    if ("credentialReference" in input && input.credentialReference) {
      return {
        encryptedCredentials: null,
        credentialReference: input.credentialReference,
        credentialKeyVersion: null
      };
    }
    return {
      encryptedCredentials: null,
      credentialReference: null,
      credentialKeyVersion: null
    };
  }

  async function requireRecord(id: string) {
    const record = await repository.findById(id);
    if (!record) {
      throw new Error("Cloud storage connection not found");
    }
    return record;
  }

  function credentialsFor(record: CloudConnectionRecord): CloudCredentials {
    if (record.encryptedCredentials) {
      return decryptCloudCredentials(record.encryptedCredentials, options.secretKey);
    }
    if (record.credentialReference) {
      return { tokenReference: record.credentialReference };
    }
    return {};
  }

  return {
    async create(input: CreateCloudConnectionInput) {
      assertCredentialPolicy(input.provider, input.credentials);
      const enabled = input.enabled ?? true;
      const record = await repository.create({
        provider: input.provider,
        displayName: input.displayName.trim(),
        accountEmail: input.accountEmail?.trim() || null,
        enabled,
        status: enabled ? "pending" : "disabled",
        providerConfigJson: JSON.stringify(input.providerConfig ?? {}),
        ...credentialFields(input)
      });
      return sanitizeCloudConnection(record);
    },

    async list() {
      return Promise.all((await repository.findMany()).map(sanitizeCloudConnection));
    },

    async get(id: string) {
      return sanitizeCloudConnection(await requireRecord(id));
    },

    async update(id: string, input: UpdateCloudConnectionInput) {
      await requireRecord(id);
      const record = await repository.update(id, {
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.accountEmail !== undefined ? { accountEmail: input.accountEmail?.trim() || null } : {}),
        ...(input.providerConfig !== undefined
          ? { providerConfigJson: JSON.stringify(input.providerConfig) }
          : {})
      });
      return sanitizeCloudConnection(record);
    },

    async enable(id: string) {
      const current = await requireRecord(id);
      const record = await repository.update(id, {
        enabled: true,
        status: current.status === "connected" ? "connected" : "pending",
        lastError: null
      });
      return sanitizeCloudConnection(record);
    },

    async disable(id: string) {
      await requireRecord(id);
      return sanitizeCloudConnection(await repository.update(id, {
        enabled: false,
        status: "disabled"
      }));
    },

    async reconnect(id: string, input: ReconnectCloudConnectionInput) {
      const current = await requireRecord(id);
      assertCredentialPolicy(parseProvider(current.provider), input.credentials);
      const record = await repository.update(id, {
        ...credentialFields(input),
        enabled: true,
        status: "pending",
        lastError: null,
        lastConnectedAt: null
      });
      return sanitizeCloudConnection(record);
    },

    async completeOAuth(input: {
      connectionId?: string;
      provider: CloudProviderType;
      displayName: string;
      accountEmail: string | null;
      credentials: Readonly<Record<string, unknown>>;
      providerConfig?: Readonly<Record<string, unknown>>;
    }) {
      assertCredentialPolicy(input.provider, input.credentials);
      const connectedAt = now();
      if (input.connectionId) {
        const current = await requireRecord(input.connectionId);
        if (parseProvider(current.provider) !== input.provider) {
          throw new Error("Cloud connection provider cannot be changed during reconnect");
        }
        const record = await repository.update(input.connectionId, {
          ...credentialFields({ credentials: input.credentials }),
          displayName: input.displayName.trim(),
          accountEmail: input.accountEmail?.trim() || null,
          enabled: true,
          status: "connected",
          providerConfigJson: JSON.stringify(input.providerConfig ?? parseConfig(current.providerConfigJson)),
          lastConnectedAt: connectedAt,
          lastTestedAt: connectedAt,
          lastError: null
        });
        return sanitizeCloudConnection(record);
      }

      const record = await repository.create({
        provider: input.provider,
        displayName: input.displayName.trim(),
        accountEmail: input.accountEmail?.trim() || null,
        enabled: true,
        status: "connected",
        providerConfigJson: JSON.stringify(input.providerConfig ?? {}),
        ...credentialFields({ credentials: input.credentials })
      });
      return sanitizeCloudConnection(await repository.update(record.id, {
        lastConnectedAt: connectedAt,
        lastTestedAt: connectedAt,
        lastError: null
      }));
    },

    async getProviderContext(id: string) {
      const record = await requireRecord(id);
      return {
        connection: {
          id: record.id,
          name: record.displayName,
          providerType: parseProvider(record.provider),
          enabled: record.enabled,
          config: parseConfig(record.providerConfigJson)
        },
        credentials: credentialsFor(record)
      };
    },

    async storeRefreshedCredentials(
      id: string,
      tokenPatch: Readonly<Record<string, unknown>>
    ) {
      const current = await requireRecord(id);
      const credentials = { ...credentialsFor(current), ...tokenPatch };
      assertCredentialPolicy(parseProvider(current.provider), credentials);
      await repository.update(id, {
        ...credentialFields({ credentials }),
        status: "connected",
        lastError: null
      });
    },

    async markConnectionError(id: string, message: string) {
      await requireRecord(id);
      return sanitizeCloudConnection(await repository.update(id, {
        status: "error",
        lastError: message
      }));
    },

    async markNeedsReauthorization(id: string, message: string) {
      await requireRecord(id);
      return sanitizeCloudConnection(await repository.update(id, {
        status: "needs_reauthorization",
        lastError: message
      }));
    },

    async disconnect(id: string) {
      await requireRecord(id);
      return sanitizeCloudConnection(await repository.update(id, {
        encryptedCredentials: null,
        credentialReference: null,
        credentialKeyVersion: null,
        enabled: false,
        status: "disabled",
        lastError: null
      }));
    },

    async test(id: string) {
      const record = await requireRecord(id);
      if (!record.enabled) {
        throw new Error("Enable the cloud storage connection before testing it");
      }

      const testedAt = now();
      try {
        const provider = createProvider({
          connection: {
            id: record.id,
            name: record.displayName,
            providerType: parseProvider(record.provider),
            enabled: record.enabled,
            config: parseConfig(record.providerConfigJson)
          },
          credentials: credentialsFor(record)
        });
        const result = await provider.testConnection();
        const updated = await repository.update(id, {
          status: result.ok ? "connected" : "error",
          lastTestedAt: testedAt,
          lastSuccessfulTestAt: result.ok ? testedAt : record.lastSuccessfulTestAt,
          lastConnectedAt: result.ok ? testedAt : record.lastConnectedAt,
          lastError: result.ok ? null : result.message
        });
        return { connection: sanitizeCloudConnection(updated), result };
      } catch (error) {
        let message = error instanceof CloudProviderError
          ? error.message
          : "Cloud connection test failed";
        try {
          for (const value of Object.values(credentialsFor(record))) {
            if (typeof value === "string" && value.length >= 4) {
              message = message.replaceAll(value, "[redacted]");
            }
          }
        } catch {
          message = "Cloud connection test failed";
        }
        await repository.update(id, {
          status: "error",
          lastTestedAt: testedAt,
          lastError: message
        });
        throw new CloudProviderError({
          providerType: parseProvider(record.provider),
          code: error instanceof CloudProviderError ? error.code : "connection_failed",
          message,
          retryable: error instanceof CloudProviderError && error.retryable
        });
      }
    },

    async remove(id: string) {
      await requireRecord(id);
      await repository.delete(id);
    }
  };
}

export const cloudConnectionService = createCloudConnectionService();
