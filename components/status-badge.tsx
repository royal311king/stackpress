import { cn } from "@/lib/utils";

export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = (value ?? "unknown").toLowerCase();
  const style =
    normalized === "completed" || normalized === "active"
      ? "badge badge-ok"
      : normalized === "failed" || normalized === "error" || normalized === "inactive"
        ? "badge badge-danger"
        : normalized === "running" || normalized === "queued"
          ? "badge badge-warn"
          : "badge badge-muted";

  return <span className={cn(style)}>{value ?? "Unknown"}</span>;
}
