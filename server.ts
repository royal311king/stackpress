import http from "node:http";
import next from "next";

import { ensureRuntimeDirectories } from "@/lib/config";
import { startScheduler } from "@/lib/services/scheduler";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

async function bootstrap() {
  ensureRuntimeDirectories();

  const app = next({ dev, hostname: "0.0.0.0", port });
  const handle = app.getRequestHandler();

  await app.prepare();
  await startScheduler();

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
