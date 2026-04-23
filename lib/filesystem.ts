import fs from "node:fs";
import path from "node:path";

export function ensureDirectory(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function pathExists(target: string) {
  return fs.existsSync(target);
}

export function safeResolve(...parts: string[]) {
  return path.resolve(...parts);
}

export function getFileSize(target: string) {
  if (!fs.existsSync(target)) {
    return 0;
  }

  return fs.statSync(target).size;
}

export function getDirectoryUsage(target: string): number {
  if (!fs.existsSync(target)) {
    return 0;
  }

  const stats = fs.statSync(target);
  if (stats.isFile()) {
    return stats.size;
  }

  return fs.readdirSync(target).reduce((total, entry) => {
    return total + getDirectoryUsage(path.join(target, entry));
  }, 0);
}
