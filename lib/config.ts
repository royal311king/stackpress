import fs from "node:fs";
import path from "node:path";

export const runtimeConfig = {
  dataRoot: path.resolve(process.env.STACKPRESS_DATA_ROOT ?? "./data"),
  storageRoot: path.resolve(process.env.STACKPRESS_STORAGE_ROOT ?? "./storage"),
  logRoot: path.resolve(process.env.STACKPRESS_LOG_ROOT ?? "./logs"),
  appUrl: process.env.STACKPRESS_APP_URL ?? "http://localhost:3000",
  timezone: process.env.STACKPRESS_TIMEZONE ?? "America/Chicago"
};

export function canonicalAppOrigin(appUrl = process.env.STACKPRESS_APP_URL ?? "http://localhost:3000") {
  const url = new URL(appUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("STACKPRESS_APP_URL must use http or https");
  }
  return url.origin;
}

export function ensureRuntimeDirectories() {
  for (const dir of [
    runtimeConfig.dataRoot,
    runtimeConfig.storageRoot,
    runtimeConfig.logRoot
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
