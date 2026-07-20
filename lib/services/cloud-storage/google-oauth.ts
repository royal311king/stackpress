import { google } from "googleapis";

import { cloudConnectionService } from "./connections";
import { CloudProviderError } from "./types";
import { GoogleOAuthFlowError } from "./google-oauth-state";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_USER_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_DRIVE_FILE_SCOPE,
  "openid",
  GOOGLE_USER_EMAIL_SCOPE
] as const;

type GoogleTokenSet = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
};

export interface GoogleOAuthClientLike {
  generateAuthUrl(options: {
    access_type: "offline";
    prompt: string;
    include_granted_scopes: boolean;
    scope: string[];
    state: string;
  }): string;
  getToken(code: string): Promise<{ tokens: GoogleTokenSet }>;
  setCredentials(credentials: GoogleTokenSet): void;
  getAccessToken(): Promise<unknown>;
  on(event: "tokens", listener: (tokens: GoogleTokenSet) => void): unknown;
}

type ConnectionService = typeof cloudConnectionService;

type GoogleOAuthServiceOptions = {
  connections?: ConnectionService;
  createClient?: () => GoogleOAuthClientLike;
  getAccountEmail?: (client: GoogleOAuthClientLike) => Promise<string | null>;
};

function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI are required"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function createOfficialGoogleClient(): GoogleOAuthClientLike {
  const config = googleOAuthConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

async function loadGoogleAccountEmail(client: GoogleOAuthClientLike) {
  const oauth2 = google.oauth2({ version: "v2", auth: client as never });
  const response = await oauth2.userinfo.get();
  return response.data.email ?? null;
}

function persistedTokens(tokens: GoogleTokenSet) {
  return Object.fromEntries(
    Object.entries(tokens).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function parseGoogleOAuthCallback(query: URLSearchParams) {
  const denied = query.get("error");
  if (denied) {
    throw new GoogleOAuthFlowError(
      denied === "access_denied" ? "access_denied" : "oauth_exchange_failed",
      denied === "access_denied" ? "Google Drive authorization was denied" : "Google OAuth failed"
    );
  }
  const code = query.get("code");
  if (!code) {
    throw new GoogleOAuthFlowError("missing_code", "Google OAuth authorization code is missing");
  }
  return { code };
}

export function createGoogleOAuthService(options: GoogleOAuthServiceOptions = {}) {
  const connections = options.connections ?? cloudConnectionService;
  const createClient = options.createClient ?? createOfficialGoogleClient;
  const getAccountEmail = options.getAccountEmail ?? loadGoogleAccountEmail;

  function authorizationUrl(state: string) {
    return createClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: true,
      scope: [...GOOGLE_OAUTH_SCOPES],
      state
    });
  }

  async function handleCallback(input: { code: string; connectionId?: string | null }) {
    const client = createClient();
    let tokens: GoogleTokenSet;
    try {
      ({ tokens } = await client.getToken(input.code));
    } catch {
      throw new GoogleOAuthFlowError("oauth_exchange_failed", "Google authorization code exchange failed");
    }
    if (!tokens.refresh_token) {
      throw new GoogleOAuthFlowError(
        "missing_refresh_token",
        "Google did not return a refresh token. Reconnect and grant consent again."
      );
    }

    client.setCredentials(tokens);
    const accountEmail = await getAccountEmail(client);
    return connections.completeOAuth({
      connectionId: input.connectionId ?? undefined,
      provider: "google_drive",
      displayName: accountEmail ? `Google Drive — ${accountEmail}` : "Google Drive",
      accountEmail,
      credentials: persistedTokens(tokens),
      providerConfig: {
        autoUpload: true,
        rootFolderName: "StackPress Backups"
      }
    });
  }

  async function authorizedClient(connectionId: string) {
    const context = await connections.getProviderContext(connectionId);
    if (context.connection.providerType !== "google_drive") {
      throw new Error("Cloud connection is not a Google Drive connection");
    }
    const client = createClient();
    client.setCredentials(context.credentials as GoogleTokenSet);
    client.on("tokens", (tokens) => {
      void connections.storeRefreshedCredentials(connectionId, persistedTokens(tokens)).catch(() => {
        // Never log token payloads. The next API call will surface a sanitized connection error.
      });
    });
    return client;
  }

  async function verifyCredentials(connectionId: string) {
    const client = await authorizedClient(connectionId);
    try {
      await client.getAccessToken();
      return true;
    } catch {
      const message = "Google authorization expired or was revoked. Reconnect the account.";
      await connections.markNeedsReauthorization(connectionId, message);
      throw new CloudProviderError({
        providerType: "google_drive",
        code: "authentication_failed",
        message,
        retryable: false
      });
    }
  }

  return { authorizationUrl, handleCallback, authorizedClient, verifyCredentials };
}

export const googleOAuthService = createGoogleOAuthService();
