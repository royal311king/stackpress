import http from "node:http";
import next from "next";

import { ensureRuntimeDirectories } from "@/lib/config";
import { startScheduler } from "@/lib/services/scheduler";
import { migrateLegacySitePaths } from "@/lib/services/settings";
import { registerBuiltInCloudStorageProviders } from "@/lib/services/cloud-storage/providers";
import { startCloudUploadWorker } from "@/lib/services/cloud-storage/upload-worker";
import { startRemoteRestoreWorker } from "@/lib/services/cloud-storage/remote-restore-jobs";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

async function bootstrap() {
  ensureRuntimeDirectories();

  const app = next({ dev, hostname: "0.0.0.0", port });
  const handle = app.getRequestHandler();

  await app.prepare();
  registerBuiltInCloudStorageProviders();
  await migrateLegacySitePaths();
  await startScheduler();
  await startCloudUploadWorker();
  await startRemoteRestoreWorker();

  http
    .createServer((req, res) => handle(req, res))
    .listen(port, "0.0.0.0", () => {
      console.log(`StackPress listening on http://0.0.0.0:${port}`);
    });
}

bootstrap().catch((error) => {
  console.error("Failed to start StackPress", error);
  process.exit(1);
});
