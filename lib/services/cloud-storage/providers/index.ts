import { getRegisteredCloudProviderTypes, registerCloudStorageProvider } from "../registry";
import { logActivity } from "@/lib/services/logging";
import { artifactLifecycleMessage } from "../types";
import { GoogleDriveProvider } from "./google-drive";

export function registerBuiltInCloudStorageProviders() {
  if (!getRegisteredCloudProviderTypes().includes("google_drive")) {
    registerCloudStorageProvider(
      "google_drive",
      (context) => new GoogleDriveProvider(context, {
        onArtifactUploaded: (artifact) => logActivity(
          "cloud_backup",
          artifactLifecycleMessage("Uploaded artifacts", [artifact.artifactKind]),
          "info",
          artifact
        )
      })
    );
  }
}
