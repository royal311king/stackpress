import { NextRequest, NextResponse } from "next/server";

import { googleOAuthService, parseGoogleOAuthCallback } from "@/lib/services/cloud-storage/google-oauth";
import {
  GoogleOAuthFlowError,
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyGoogleOAuthState
} from "@/lib/services/cloud-storage/google-oauth-state";

function settingsUrl(request: NextRequest, status: string, reason?: string) {
  const url = new URL("/settings/backups/cloud-providers", request.url);
  url.searchParams.set("cloud", status);
  if (reason) url.searchParams.set("reason", reason);
  return url;
}

export async function GET(request: NextRequest) {
  const responseWithClearedCookie = (response: NextResponse) => {
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/cloud-storage/google/callback",
      maxAge: 0
    });
    return response;
  };

  try {
    const state = verifyGoogleOAuthState({
      cookieValue: request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value,
      returnedState: request.nextUrl.searchParams.get("state")
    });
    const { code } = parseGoogleOAuthCallback(request.nextUrl.searchParams);
    await googleOAuthService.handleCallback({
      code,
      connectionId: state.connectionId
    });
    return responseWithClearedCookie(
      NextResponse.redirect(settingsUrl(request, "google_connected"))
    );
  } catch (error) {
    if (error instanceof GoogleOAuthFlowError && error.code === "invalid_state") {
      return responseWithClearedCookie(
        NextResponse.json({ error: "Invalid or expired Google OAuth state" }, { status: 400 })
      );
    }
    if (error instanceof GoogleOAuthFlowError && error.code === "access_denied") {
      return responseWithClearedCookie(
        NextResponse.redirect(settingsUrl(request, "google_denied"))
      );
    }
    const reason = error instanceof GoogleOAuthFlowError ? error.code : "callback_failed";
    return responseWithClearedCookie(
      NextResponse.redirect(settingsUrl(request, "google_error", reason))
    );
  }
}
