import { getRegisteredCloudProviderTypes, registerCloudStorageProvider } from "../registry";
import { GoogleDriveProvider } from "./google-drive";

export function registerBuiltInCloudStorageProviders() {
  if (!getRegisteredCloudProviderTypes().includes("google_drive")) {
    registerCloudStorageProvider(
      "google_drive",
      (context) => new GoogleDriveProvider(context)
    );
  }
}
