import { canonicalAppOrigin } from "@/lib/config";

export type GoogleOAuthCompletionStatus = "connected" | "cancelled" | "error";

export function googleOAuthCompletionUrl(
  status: GoogleOAuthCompletionStatus,
  reason?: string,
  appUrl?: string
) {
  const url = new URL("/settings/backups/cloud-providers", canonicalAppOrigin(appUrl));
  url.searchParams.set("google", status);
  if (reason) url.searchParams.set("reason", reason);
  return url;
}
