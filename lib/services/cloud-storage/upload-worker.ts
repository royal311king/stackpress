import cron from "node-cron";

import { processCloudUploadQueue, recoverStaleCloudUploadJobs } from "./upload-jobs";

let started = false;
let processing = false;

async function tick() {
  if (processing) return;
  processing = true;
  try {
    await processCloudUploadQueue();
  } finally {
    processing = false;
  }
}

export async function startCloudUploadWorker() {
  if (started) return;
  started = true;
  await recoverStaleCloudUploadJobs();
  void tick();
  cron.schedule("*/5 * * * * *", () => void tick());
}
