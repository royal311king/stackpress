import { NextRequest, NextResponse } from "next/server";

import {
  AdminAuthorizationError,
  requireStackPressAdmin
} from "@/lib/auth/admin";
import { cloudConnectionService } from "@/lib/services/cloud-storage/connections";
import { googleOAuthService } from "@/lib/services/cloud-storage/google-oauth";
import {
  createGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS
} from "@/lib/services/cloud-storage/google-oauth-state";

function adminError(error: AdminAuthorizationError) {
  return NextResponse.json(
    { error: error.message },
    {
      status: error.status,
      headers: error.status === 401
        ? { "WWW-Authenticate": 'Basic realm="StackPress Administrator"' }
        : undefined
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    requireStackPressAdmin(request);
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    if (connectionId) {
      const connection = await cloudConnectionService.get(connectionId);
      if (connection.provider !== "google_drive") {
        return NextResponse.json({ error: "Connection is not a Google Drive account" }, { status: 400 });
      }
    }

    const oauthState = createGoogleOAuthState({ connectionId });
    const response = NextResponse.redirect(googleOAuthService.authorizationUrl(oauthState.state));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, oauthState.cookieValue, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/cloud-storage/google/callback",
      maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS
    });
    return response;
  } catch (error) {
    if (error instanceof AdminAuthorizationError) return adminError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start Google OAuth" },
      { status: 400 }
    );
  }
}
