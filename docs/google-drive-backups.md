# Google Drive backups

StackPress keeps its existing local backup as the primary backup. Google Drive is an optional post-backup copy: after a local backup finishes successfully, StackPress queues an independent upload for every enabled cloud destination. A cloud failure never changes the completed local backup to failed and never removes its local artifacts.

## Prerequisites

You need a Google account with access to a Google Cloud project, a persistent StackPress database, configured StackPress administrator credentials, and a stable 32-byte encryption key. Production deployments also need a publicly reachable HTTPS URL. Google permits HTTP OAuth redirects only for localhost.

StackPress uses Google Drive API v3 through Google's official Node.js SDK. It requests `drive.file`, a narrow, non-sensitive scope that lets StackPress manage files it creates without granting access to the account's entire Drive. Google recommends this scope for per-file access; see [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Google Cloud project setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/), then create or select a project.
2. Open **APIs & Services → Library**, select **Google Drive API**, and click **Enable**. Google documents this in [Enable the Drive API](https://developers.google.com/workspace/drive/api/guides/enable-sdk#enable_the_drive_api). StackPress does not require a Drive UI integration or Marketplace listing.
3. Open **Google Auth Platform** for the same project.

## OAuth consent-screen setup

In Google Auth Platform:

1. Under **Branding**, set the application name, support email, and developer contact email. Public production apps also need the required homepage, privacy-policy, and authorized-domain fields.
2. Under **Audience**, choose **Internal** if only users in your Google Workspace organization will connect. Otherwise choose **External**. During development, add each connecting account as a test user.
3. Under **Data Access**, add exactly:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/drive.file`
4. Keep an external app in **Testing** only during development. External test apps are restricted to named test users and can receive refresh tokens that expire after seven days. Publish the app for durable production connections; see [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

StackPress does not request the broad `drive` or `drive.readonly` scopes.

## OAuth client creation and redirect URI

1. Open **Google Auth Platform → Clients**.
2. Click **Create client** and choose **Web application**.
3. Add the exact authorized redirect URI. For local development:

   ```text
   http://localhost:3000/api/cloud-storage/google/callback
   ```

   For production, change only the origin, for example:

   ```text
   https://stackpress.example.com/api/cloud-storage/google/callback
   ```

4. Create the client and securely record its client ID and client secret. Do not commit the secret or downloaded client JSON.

The scheme, hostname, port, and path must match `GOOGLE_OAUTH_REDIRECT_URI` exactly. Google explains web clients and redirect validation in [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred).

## Environment variables

Set these values in the StackPress process or deployment secret store:

```dotenv
STACKPRESS_SECRET_KEY=<base64-encoded 32-byte key>
STACKPRESS_ADMIN_USERNAME=admin
STACKPRESS_ADMIN_PASSWORD=<long unique password>
GOOGLE_OAUTH_CLIENT_ID=<OAuth web client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<OAuth web client secret>
GOOGLE_OAUTH_REDIRECT_URI=https://stackpress.example.com/api/cloud-storage/google/callback
STACKPRESS_INSTALLATION_NAME=<stable installation label>
```

Generate the encryption key once:

```bash
openssl rand -base64 32
```

Keep `STACKPRESS_SECRET_KEY` stable and backed up in a secret manager. StackPress uses it for AES-256-GCM credential encryption and OAuth-state signing. Changing or losing it makes stored credentials unreadable and requires reconnecting accounts. Never reuse the Google client secret as this key.

`STACKPRESS_INSTALLATION_NAME` is optional but recommended. It keeps the Drive hierarchy stable when a hostname changes. Restart StackPress after changing environment variables. Docker Compose already passes these variables through from the deployment environment.

Before the first cloud-enabled deployment, back up and migrate the existing StackPress database. Installations created by older releases must mark the checked-in pre-cloud schema as applied once before deploying the additive migrations:

```bash
cp data/stackpress.db "data/stackpress.db.backup-$(date +%Y%m%d-%H%M%S)"
npx prisma generate
npx prisma migrate resolve --applied 20260715000000_baseline_stackpress_schema
npx prisma migrate deploy
```

Do not resolve the baseline on an empty database. New installations run the complete migration chain directly with `npx prisma migrate deploy`.

## Connecting an account

1. Authenticate through the StackPress administrator HTTP Basic challenge.
2. Open **Settings → Backups → Cloud Providers**.
3. Click **Connect Google Drive**.
4. Select the account and approve the requested permissions.
5. Confirm that the account email appears with **Connected** status.
6. Run **Test connection**.

The authorization request uses offline access so workers can refresh short-lived access tokens. The refresh token is encrypted before database storage. Tokens, authorization codes, and the OAuth client secret are never returned by the connections API. The callback validates a short-lived signed state value in an HttpOnly, SameSite cookie before exchanging the code.

Multiple Google accounts can be connected. Disconnecting clears that connection's stored credentials and disables future operations; it does not delete local backups or recorded remote metadata.

## Enabling Google Drive for a site

1. Open the site's existing backup configuration.
2. Enable cloud copies and select one or more connected accounts.
3. Optionally set a remote site-folder name.
4. Choose whether scheduled and manual backups upload automatically.
5. Select a retention relationship:
   - **Retain remote copy** leaves Drive files when the local backup expires.
   - **Delete with local** asks Drive to delete stored remote file IDs when the existing local retention decision expires the backup.
6. Save and test the selected connection.

Existing sites stay local-only until a destination is explicitly enabled. Removing a destination stops future uploads but leaves prior Drive copies intact.

## Upload behavior

StackPress first completes the normal local database dump, files archive, and manifest. It then creates one durable, idempotent upload job per backup and connection. The worker streams existing artifacts from disk and does not buffer an archive in memory.

The default hierarchy is:

```text
StackPress Backups/
  <installation name or hostname>/
    <site name or configured folder>/
      db-<timestamp>.sql
      files-<timestamp>.tar.gz
      manifest-<timestamp>.json
```

Uploads use Drive's resumable-upload mode and report job progress. StackPress stores provider file IDs and ownership `appProperties`, refetches each uploaded file, verifies its size, and compares MD5 or SHA-256 when Drive exposes a compatible checksum. Google recommends resumable uploads for large or interruption-prone files: [Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads#resumable).

Transient network, rate-limit, and Drive 5xx failures use bounded exponential backoff with jitter and honor `Retry-After` when present. Authentication, permission, and storage-quota errors are not retried indefinitely. Database uniqueness prevents two jobs for the same backup/account. After restart, stale running jobs return to the queue; StackPress checks stored IDs and Drive metadata before creating another file.

The resumable session URI is not persisted. A process crash can restart the current artifact from byte zero; duplicate discovery prevents another completed StackPress file after an indeterminate response.

## Restore behavior

The normal local restore path is unchanged. When the required local artifacts are unavailable and verified Google Drive database and files copies exist:

1. StackPress queues a background remote-restore job.
2. The worker checks temporary disk space.
3. It streams each artifact into a unique controlled temporary directory without overwriting an existing file.
4. It verifies recorded size and a compatible checksum.
5. It passes the temporary paths to the existing restore engine, preserving its pre-restore safety snapshot.
6. It removes temporary files after success or failure.

Restore logs record the provider, connection, backup, and remote file IDs, but not tokens. Interrupted reads are retried. Crash leftovers are removed after 24 hours; active downloads heartbeat their job so they are not reclaimed as stale.

## Reauthorization

If Google rejects a refresh token, StackPress marks the account **Needs Reauthorization**. Open Cloud Providers and click **Reconnect**. Reconnection requests consent again and replaces the encrypted credentials while preserving the connection ID, site assignments, upload history, and remote metadata.

Revoking StackPress in the Google Account's third-party access controls also stops operations until reconnection.

## Retention and remote deletion

Cloud deletion is independent from local deletion. StackPress deletes only by a provider file ID stored for that backup. Immediately before deletion it fetches the file and validates the StackPress-managed marker, backup ID, and artifact kind. A mismatch is refused.

Retention will not delete a remote copy while upload, verification, or restore is active and honors existing pinned/protected backup rules. A disconnected account leaves remote records intact and marks cleanup unavailable. A partial Drive deletion error is recorded without corrupting the local backup record.

## Troubleshooting

### `redirect_uri_mismatch`

Compare the Google OAuth client's redirect URI with `GOOGLE_OAUTH_REDIRECT_URI` character for character, including scheme, host, port, path, and trailing slash. Production redirects must use HTTPS.

### Invalid or expired OAuth state

Restart the connection from Cloud Providers and complete it within ten minutes in the same browser. Allow cookies for StackPress and ensure every application replica uses the same `STACKPRESS_SECRET_KEY`.

### No refresh token returned

Reconnect and approve consent again. If needed, revoke the prior grant in the Google Account first. StackPress rejects credentials without a refresh token because unattended uploads would stop after access-token expiry.

### Reauthorization repeats

Check whether an external OAuth app is still in Testing, whether the account remains a test user, whether a Workspace administrator blocked the app, or whether the user revoked access. External Testing refresh tokens can expire after seven days.

### Permission denied

Confirm the Drive API is enabled in the OAuth client's project, `drive.file` is on the consent screen, and Workspace policy permits the app. That scope can manage StackPress-created files, not arbitrary existing Drive content.

### Quota or rate-limit errors

Free storage in the connected Drive account for quota failures. For rate limits, leave the job queued or retry it later. See Google's [Drive error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors).

### Upload stuck after restart

The worker automatically requeues a running job when its heartbeat is stale. Confirm the server is running, local artifacts still exist, and the account is enabled. A queued or running upload protects its local archive from retention cleanup.

### Insufficient restore disk space

Free space in the operating system temporary directory. StackPress requires the recorded artifact sizes plus a 64 MiB safety margin, in addition to space needed by the existing restore engine.

## Operational security

- Terminate TLS at StackPress or a trusted reverse proxy. Never expose HTTP Basic credentials over plaintext HTTP.
- Apply reverse-proxy request limits to StackPress generally and especially `/api/cloud-storage/` and administrator mutation routes. StackPress has no distributed application rate limiter.
- Restrict database and filesystem access. SQLite contains encrypted OAuth credentials and backup metadata.
- Back up `STACKPRESS_SECRET_KEY` separately from the database.
- Keep dependencies current and monitor activity logs for repeated authorization, upload, verification, and deletion failures.

## Current limitations

- Google Drive is the only implemented cloud provider.
- StackPress has no first-class user/session or role system. Cloud-sensitive routes use configured HTTP Basic administrator credentials and fail closed if they are absent.
- There is no distributed rate limiter; use a reverse proxy for internet-exposed deployments.
- Resumable session URIs do not survive process crashes, so an interrupted artifact may restart from byte zero.
- Manual Drive download currently prepares server-side temporary artifacts; it is not a browser file-delivery endpoint.
- Remote folder selection is a StackPress-managed name, not an arbitrary Drive picker.
- Shared Drives are not explicitly supported.
- The worker and SQLite design target one StackPress process. Multi-replica deployments require coordinated worker ownership and a database suited to concurrent writers.
- Credential encryption supports one active key version; automated key rotation is not implemented.
