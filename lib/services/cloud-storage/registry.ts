import type { CloudStorageProvider } from "./provider";
import {
  CloudProviderError,
  type CloudProviderContext,
  type CloudProviderType
} from "./types";

export type CloudStorageProviderFactory = (
  context: CloudProviderContext
) => CloudStorageProvider;

const factories = new Map<CloudProviderType, CloudStorageProviderFactory>();

export function registerCloudStorageProvider(
  providerType: CloudProviderType,
  factory: CloudStorageProviderFactory
) {
  if (factories.has(providerType)) {
    throw new CloudProviderError({
      providerType,
      code: "conflict",
      message: `Cloud storage provider is already registered: ${providerType}`
    });
  }

  factories.set(providerType, factory);
}

export function createCloudStorageProvider(context: CloudProviderContext) {
  const providerType = context.connection.providerType;
  const factory = factories.get(providerType);

  if (!factory) {
    throw new CloudProviderError({
      providerType,
      code: "invalid_configuration",
      message: `Cloud storage provider is not registered: ${providerType}`
    });
  }

  return factory(context);
}

export function getRegisteredCloudProviderTypes() {
  return [...factories.keys()];
}

/** Intended for isolated tests; application code should register once at startup. */
export function clearCloudStorageProvidersForTests() {
  factories.clear();
}
