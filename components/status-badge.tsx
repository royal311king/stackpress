import { cn } from "@/lib/utils";

function formatStatusLabel(value?: string | null) {
  const normalized = (value ?? "unknown").toLowerCase();

  if (normalized === "success_with_warnings") {
    return "Success With Warnings";
  }

  if (normalized === "success") {
    return "Success";
  }

  if (normalized === "completed") {
    return "Success";
  }

  return (value ?? "Unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = (value ?? "unknown").toLowerCase();
  const style =
    normalized === "success" || normalized === "completed" || normalized === "active" || normalized === "enabled" || normalized === "online"
      ? "badge badge-ok"
      : normalized === "success_with_warnings" || normalized === "warn"
        ? "badge badge-caution"
        : normalized === "failed" || normalized === "error" || normalized === "inactive" || normalized === "invalid" || normalized === "down"
          ? "badge badge-danger"
          : normalized === "running" || normalized === "info"
            ? "badge badge-info"
            : normalized === "queued" || normalized === "disabled" || normalized === "manual" || normalized === "unknown"
              ? "badge badge-muted"
              : "badge badge-muted";

  return <span className={cn(style)}>{formatStatusLabel(value)}</span>;
}
