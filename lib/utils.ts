import { clsx } from "clsx";
import { format, formatDistanceToNowStrict } from "date-fns";

export function cn(...parts: Array<string | false | null | undefined>) {
  return clsx(parts);
}

export function formatTimestamp(value?: Date | string | null) {
  if (!value) {
    return "Never";
  }

  return format(new Date(value), "yyyy-MM-dd HH:mm:ss");
}

export function formatRelative(value?: Date | string | null) {
  if (!value) {
    return "No activity";
  }

  return `${formatDistanceToNowStrict(new Date(value))} ago`;
}

export function formatBytes(value?: bigint | number | null) {
  if (!value) {
    return "0 B";
  }

  const bytes = typeof value === "bigint" ? Number(value) : value;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = bytes;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
