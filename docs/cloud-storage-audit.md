# StackPress Cloud Storage Audit

## Purpose

This document describes the backup system that exists in this repository today and proposes the smallest clean extension for optional cloud copies. It does not redesign the local backup engine. The existing local backup remains the source of truth and must complete before any cloud upload begins.

The intended extension is:

1. StackPress runs its existing local backup process.
2. The local `BackupJob` reaches `success` or `success_with_warnings`.
3. StackPress creates independent upload records for the cloud destinations configured for that site.
4. Cloud upload failures do not change the completed local backup into a failed backup.
5. Restore continues to use local artifacts initially. Download-before-restore can be added later without changing local backup creation.

## Executive summary

StackPress already has a complete local backup path centered on `runBackup()` in `lib/services/backup.ts`. That function creates the job record, generates database and file artifacts, writes a manifest, updates status, enforces retention, and records activity.

There is currently:

- no storage-provider interface;
- no cloud-destination model;
- no cloud credential store;
- no durable worker queue;
- no separate status for copies of one backup;
- no checksum in the manifest or database;
- no Prisma migration directory.

The smallest clean cloud extension is not to make the backup engine provider-driven. It is to add a post-backup replication layer with three new records:

- `CloudStorageConnection`: a configured account or destination;
- `SiteCloudDestination`: which connections a site should use;
- `BackupUpload`: the status and remote object metadata for one backup copied to one connection.

A small `CloudStorageProvider` interface should cover upload, delete, health testing, and later download. Google Drive can be the first adapter. The existing local paths, `BackupJob`, manifest, restore flow, and retention behavior should otherwise remain intact.

## Current backup flow

### Entry points

There are three ways a backup is started:

| Trigger | Repository entry point | Behavior |
| --- | --- | --- |
| Manual site backup | `POST app/api/sites/[id]/backup/route.ts` | Calls `runBackup(id, "manual")` without awaiting completion and returns `{ ok: true }`. |
| Bulk backup | `POST app/api/backups/run-all/route.ts` | Starts `runBackupAllActiveSites()` without awaiting completion. That service processes active sites sequentially. |
| Scheduled backup | `tick()` in `lib/services/scheduler.ts` | Calculates due schedules and awaits `runBackup(site.id, "schedule")` for each due site. |

`POST app/api/scheduler/run/route.ts` only calls `startScheduler()`. The scheduler is also started during application bootstrap in `server.ts`.

### Job creation

`runBackup()` in `lib/services/backup.ts` is the central backup operation.

It:

1. Loads the `Site` with Prisma.
2. Loads global settings through `getAppSettings()` from `lib/services/settings.ts`.
3. Rejects a second job for the same site when an existing `BackupJob` has status `queued` or `running`.
4. Creates a `BackupJob` directly with status `running`, a `startedAt` timestamp, and progress step `checking`.
5. Creates the backup artifacts.
6. Updates the same record with final artifact paths, byte count, status, duration, and messages.
7. Updates summary fields on `Site`.
8. Runs `enforceRetention(site.id)`.

Although `queued` is a recognized/default database status, `runBackup()` does not currently create a queued record. It creates a running record immediately.

### Artifact creation

The local destination is resolved by `lib/services/paths.ts`:

- `resolveBackupFolder(site, settings)` resolves the site-specific backup folder.
- `resolveStackPressBackupDirectory(site, settings)` appends `stackpress`.
- The standard location is `<backupRoot>/<site.slug>/stackpress`.
- `customBackupDestination` can override the derived site folder.

`runBackup()` creates the destination recursively before writing artifacts.

Artifact names use a `yyyy-MM-dd_HH-mm-ss` timestamp:

- `db-<timestamp>.sql`
- `files-<timestamp>.tar.gz`
- `manifest-<timestamp>.json`

Database backups are produced with `mysqldump` inside the configured database container and copied out with `docker cp`. File backups are produced with `tar` from the resolved site directory. The archive exclusions are the `DEFAULT_FILE_ARCHIVE_EXCLUSIONS` constant in `lib/services/backup.ts`.

Backup modes are stored on `Site.backupMode` and validated in `lib/validators.ts` as:

- `full`
- `database`
- `files`

### Current manifest

`runBackup()` writes a JSON manifest beside the artifacts. Its current fields are:

| Field | Source |
| --- | --- |
| `timestamp` | Backup start time in ISO format |
| `siteId` | `Site.id` |
| `siteSlug` | `Site.slug` |
| `backupType` | `Site.backupMode` |
| `dbDumpPath` | Absolute local SQL path or `null` |
| `filesArchivePath` | Absolute local archive path or `null` |
| `dbBytes` | SQL file size |
| `filesBytes` | Archive file size |
| `warnings` | Recoverable warnings, currently including certain live-file tar warnings |
| `fileExclusions` | The archive exclusion patterns used |

The manifest has no explicit schema version, backup ID, checksum, cloud object metadata, or portability-safe artifact names separate from absolute local paths.

`lib/services/backup-details.ts` reads and parses this file directly. `app/(dashboard)/backups/[id]/page.tsx` also reads the raw manifest file to display it.

### Completion and failures

On successful artifact creation, `runBackup()` sets:

- `status`: `success` or `success_with_warnings`;
- `progressStep`: `complete`;
- `completedAt`;
- `durationSeconds`;
- `totalBytes`;
- `dbDumpPath`, `filesArchivePath`, and `manifestPath`;
- `logExcerpt` for warning text;
- `errorMessage`: `null`.

On failure, `failJob()` sets:

- `status`: `failed`;
- `progressStep`: `failed`;
- `completedAt`;
- `errorMessage`.

It also updates `Site.lastBackupAt`, `Site.lastBackupStatus`, and `Site.lastBackupMessage`.

The statuses considered restorable are exported as `RESTORABLE_BACKUP_STATUSES` from `lib/services/backup.ts`:

- `success`
- `success_with_warnings`
- `completed` (legacy compatibility)

The UI knows how to display `queued`, `running`, `success`, `success_with_warnings`, `completed`, and `failed` through `components/status-badge.tsx`.

Progress steps currently observed in `runBackup()` are:

- `checking`
- `dumping-db`
- `archiving-files`
- `writing-manifest`
- `complete`
- `failed`

### Persistence and logging

Backup history is persisted in SQLite through Prisma. `lib/prisma.ts` owns the singleton `PrismaClient`.

`BackupJob` in `prisma/schema.prisma` stores the job lifecycle and three local artifact paths. It belongs to a `Site` with `onDelete: Cascade`. It has indexes on `(siteId, createdAt)` and `(status, createdAt)`.

Operational events are separately written by `logActivity()` in `lib/services/logging.ts` to both:

- `<STACKPRESS_LOG_ROOT>/stackpress.log` as JSON lines;
- the Prisma `ActivityLog` table, with optional JSON serialized into `metaJson`.

Backup activity metadata commonly includes `siteId`, `backupId`, `triggerSource`, warnings, and the local destination. `getBackupDetail()` correlates activity by IDs and, as a fallback, by site and time window.

## Database and migration audit

### Existing models

`prisma/schema.prisma` contains four models:

- `Site`: WordPress/Docker configuration, backup schedule, backup mode, retention policy, local path overrides, last-backup summary, and health status.
- `BackupJob`: one local backup run and its artifact paths/status.
- `AppSetting`: singleton global settings, including `backupRoot`, `sitesRoot`, scheduler state, timezone, log root, and disk threshold.
- `ActivityLog`: application activity events.

### Migration mechanism

There is no `prisma/migrations` directory in the repository. The only Prisma file under `prisma/` is `schema.prisma`.

The repository exposes both `prisma:migrate` and `prisma:push` scripts in `package.json`, but deployment currently applies schema changes with:

`npx prisma db push --skip-generate`

from `docker-entrypoint.sh`.

`server.ts` additionally calls `migrateLegacySitePaths()` from `lib/services/settings.ts` during startup. That is an application-level data migration for the root-path refactor, not a versioned Prisma schema migration.

Cloud schema changes therefore need either:

1. additive Prisma fields/models compatible with the existing `db push` deployment convention; or
2. an intentional project decision to begin checking in versioned Prisma migrations.

For the smallest extension, additive models and fields are compatible with the current convention. Before production scale or multiple application replicas, versioned migrations should become the preferred approach.

## Current job and worker architecture

There is no external queue, worker process, message broker, lease table, or retry scheduler.

Current work runs inside the StackPress Node process:

- `server.ts` starts Next.js and the in-process cron scheduler.
- Manual and bulk API routes launch promises with `void ...catch(...)` and return immediately.
- The scheduler awaits backups from its minute-based `node-cron` loop.
- `runBackupAllActiveSites()` in `lib/services/backup-all.ts` runs active sites sequentially and tracks the batch only through `ActivityLog` metadata and an in-memory summary object.

Consequences relevant to cloud uploads:

- fire-and-forget work can be interrupted by process restarts;
- no durable retry exists;
- no worker can claim abandoned work;
- a `running` backup can remain stale after a crash;
- concurrency protection is a database query, not an atomic lease;
- SQLite and a single process are the assumed deployment profile.

The cloud extension should not require Redis or a separate worker for its first release. It should, however, persist upload intent before starting network work so failed or interrupted uploads can be retried after restart.

## Existing settings architecture

Global settings use the singleton `AppSetting` row with ID `singleton`.

- `getAppSettings()` in `lib/services/settings.ts` upserts the row and seeds runtime defaults from `lib/config.ts`.
- `POST app/api/settings/route.ts` validates and upserts settings.
- `settingsSchema` in `lib/validators.ts` validates the request.
- `app/(dashboard)/settings/page.tsx` loads settings server-side.
- `SettingsForm` in `components/forms.tsx` edits them client-side.

Site-level backup behavior is stored directly on `Site`: schedule fields, backup mode, retention fields, and custom local destination.

Cloud connections do not fit cleanly as more columns on `AppSetting`, because StackPress needs multiple providers/connections and per-site selection. They should be separate relational records.

## Existing backup-related API routes

| Route | Method | Current responsibility |
| --- | --- | --- |
| `app/api/sites/[id]/backup/route.ts` | POST | Start one manual backup. |
| `app/api/backups/run-all/route.ts` | POST | Start sequential backups for all active sites. |
| `app/api/backups/[id]/delete/route.ts` | POST | Delete the three recorded local files, delete the `BackupJob`, and log the action. |
| `app/api/sites/[id]/restore/route.ts` | POST | Restore a specified or latest successful local backup, optionally with a safety snapshot. |
| `app/api/scheduler/run/route.ts` | POST | Ensure the in-process scheduler has started. |
| `app/api/settings/route.ts` | POST | Update global application/local-root settings. |

Supporting filesystem and site-validation routes operate on local/container-visible paths. There are no connection, OAuth callback, upload retry, remote delete, or provider health-test routes.

## Existing frontend backup surfaces

### Pages

- `app/(dashboard)/page.tsx`: dashboard summary, “Backup All Sites,” recent backups, storage usage, and bulk activity.
- `app/(dashboard)/backups/page.tsx`: cross-site `BackupJob` table with status, trigger, progress, type, size, duration, details, restore, and delete actions.
- `app/(dashboard)/backups/[id]/page.tsx`: detailed job, local artifacts, manifest, retention position, warnings, related logs, restore, and delete.
- `app/(dashboard)/sites/[id]/page.tsx`: per-site backup action, schedule state, configured paths, history, restore, and delete.
- `app/(dashboard)/settings/page.tsx`: application roots and scheduler settings.

### Components

- `ActionButton` in `components/forms.tsx` invokes backup endpoints and refreshes the page.
- `RestoreBackupButton` validates artifact availability and drives the restore confirmation/safety-snapshot flow.
- `DeleteBackupButton` invokes local backup deletion after confirmation.
- `SettingsForm` manages singleton settings.
- `SiteForm` manages local backup mode, schedule, retention, and custom path behavior.
- `StatusBadge` in `components/status-badge.tsx` maps job and operational states to presentation.
- `AutoRefresh` is used on backup pages for polling-by-refresh rather than live events.

The smallest UI addition is to extend the existing settings and backup-detail surfaces rather than create a parallel backup product area.

## Credentials and secrets audit

There is no general credential vault or encryption service.

Current database credentials (`dbUser` and `dbPassword`) are stored as plaintext columns on `Site` in SQLite. They are submitted through the site API and used by `runBackup()` and `runRestore()` when constructing Docker command arguments.

Runtime configuration in `.env.example`, `lib/config.ts`, and `docker-compose.yml` contains paths, URL, timezone, and `DATABASE_URL`; it does not define cloud credentials or an application encryption key.

No dependency in `package.json` provides cloud OAuth, secret encryption, or keychain integration.

Cloud refresh tokens must not be copied into `ActivityLog.metaJson`, manifests, error text, or browser responses. Even for a self-hosted product, storing OAuth tokens as ordinary plaintext settings would enlarge the current security risk. The first cloud release should introduce encrypted-at-rest credential payloads using an application key supplied through an environment variable. The database should store ciphertext, IV/nonce, authentication tag, key version, and non-secret connection metadata separately.

## Storage-provider abstraction audit

No storage-provider abstraction exists today.

The local filesystem is not represented as a provider. Local path operations are directly embedded in:

- `lib/services/backup.ts` for creation and retention deletion;
- `lib/services/restore.ts` for artifact validation and restore;
- `app/api/backups/[id]/delete/route.ts` for deletion;
- `lib/services/backup-details.ts` and the detail page for manifest reads;
- `lib/services/paths.ts` for destination resolution.

This is appropriate for the existing engine. Adding cloud support does not require wrapping or replacing these local operations. The provider abstraction should apply only to post-backup replicas.

## Smallest clean cloud extension

### Boundary

Keep `runBackup()` responsible for producing and validating the local recovery point. Add one post-success hook after the `BackupJob` has been updated to its final local success status.

That hook should:

1. Read enabled cloud destinations for the site.
2. Create one durable `BackupUpload` row per destination using a uniqueness constraint.
3. Dispatch or immediately process those upload rows.
4. Return without altering the local job’s success status.

The existing `BackupRunResult` can remain local-backup focused. Upload progress belongs to `BackupUpload`, not `BackupJob.progressStep`, because one local backup can have multiple simultaneous destinations and outcomes.

### Minimal provider contract

Add a provider-neutral contract under a new cloud-storage service folder. The contract needs only these capabilities initially:

- identify the provider type;
- validate non-secret configuration;
- test/authenticate a connection;
- upload a named local file as a remote object;
- delete a remote object;
- optionally expose download now or reserve it for the restore phase.

An upload result should return provider-neutral metadata:

- remote object ID;
- remote path/name;
- byte count;
- provider checksum/ETag when meaningful;
- web URL when the provider exposes one;
- provider-specific metadata serialized as JSON.

Do not force Google Drive concepts such as folder IDs into the generic interface. They belong in the Google Drive connection configuration and adapter.

### Proposed folder additions

```text
lib/services/cloud-storage/
  types.ts                 # Provider-neutral contracts and status types
  registry.ts              # Maps providerType to an adapter
  credentials.ts           # Encrypt/decrypt credential payloads
  uploads.ts               # Creates, claims, runs, and retries BackupUpload rows
  naming.ts                # Stable remote folder/object naming
  providers/
    google-drive.ts        # First provider adapter
```

This folder is additive. `lib/services/backup.ts` remains the local backup engine.

### Proposed database additions

#### `CloudStorageConnection`

Represents one configured account/destination, such as “Primary Google Drive.” Recommended fields:

- `id`
- `name`
- `providerType` (`google_drive` initially)
- `enabled`
- `configJson` for non-secret provider configuration such as root folder ID
- encrypted credential fields or one versioned encrypted payload
- `credentialKeyVersion`
- `lastTestedAt`
- `lastTestStatus`
- `lastTestError`
- `createdAt`
- `updatedAt`

#### `SiteCloudDestination`

Joins a site to a connection and allows cloud replication to be optional per site:

- `id`
- `siteId`
- `connectionId`
- `enabled`
- optional remote subfolder override
- timestamps

Use a unique constraint on `(siteId, connectionId)`.

#### `BackupUpload`

Tracks one backup replicated to one configured connection:

- `id`
- `backupJobId`
- `connectionId`
- `status`
- `attemptCount`
- `nextAttemptAt`
- `startedAt`
- `completedAt`
- `lastHeartbeatAt`
- `bytesUploaded`
- `totalBytes`
- `remotePrefix`
- `remoteManifestId`
- `remoteDbObjectId`
- `remoteFilesObjectId`
- `remoteMetadataJson`
- `errorMessage`
- timestamps

Use a unique constraint on `(backupJobId, connectionId)` to make dispatch idempotent. Index `(status, nextAttemptAt)` for durable polling and `backupJobId` for UI/detail lookup.

Suggested upload statuses are:

- `pending`
- `uploading`
- `success`
- `failed`
- `retry_wait`
- `cancelled`
- `deleting`
- `delete_failed`

These statuses are deliberately separate from local backup statuses.

### Upload unit and remote layout

The current backup is a set of up to three files, not a single bundle. The first cloud adapter should upload the existing SQL dump, tar archive, and manifest as separate objects. Repacking them would add disk I/O and create a second artifact format without improving the existing backup.

Use a stable remote prefix based on identifiers rather than absolute local paths, for example:

```text
StackPress/<site-slug>/<backup-job-id>/
  db-<timestamp>.sql
  files-<timestamp>.tar.gz
  manifest-<timestamp>.json
```

The manifest should be uploaded last. Its presence can act as the remote completion marker.

### Checksums

The current engine records sizes but not checksums. Cloud copies need end-to-end integrity independent of provider-specific ETags.

The smallest safe change is to calculate SHA-256 for each artifact after local creation and before dispatching uploads. Persist checksums either:

- in new checksum fields associated with the local backup artifacts; or
- in a minimally versioned manifest extension and the `BackupUpload` remote metadata.

Because the current `BackupJob` has one column per artifact, explicit `dbSha256`, `filesSha256`, and `manifestSha256` columns are the smallest schema change. A normalized artifact table would be cleaner for many artifact types but is not required to add the first cloud provider.

After upload, compare the local SHA-256 with a provider-reported cryptographic checksum only when the provider offers an equivalent value. Otherwise, validate byte count and record the local SHA-256 as metadata alongside the remote object. Google Drive’s checksum behavior should be handled inside its adapter rather than assumed by the generic layer.

### Manifest extension

Do not replace the existing manifest. Add backward-compatible fields:

- `schemaVersion`
- `backupId`
- an `artifacts` array containing logical type, filename, size, and SHA-256

Do not write credentials or access URLs into the manifest. Cloud upload IDs and state belong in `BackupUpload`; otherwise uploading the manifest last creates a circular need to rewrite and re-upload it.

### Durable processing without a new queue product

For the first provider, use `BackupUpload` as a database-backed work queue within the existing process:

1. The post-success hook inserts `pending` rows transactionally/idempotently.
2. An in-process poller started from `server.ts` claims eligible rows.
3. Claiming changes `pending` or due `retry_wait` to `uploading` and increments `attemptCount`.
4. The worker periodically updates `lastHeartbeatAt` and byte progress when the SDK permits.
5. Success stores remote IDs and sets `completedAt`.
6. Transient failures use exponential backoff with jitter and `nextAttemptAt`.
7. Permanent authentication/configuration failures become `failed` and update connection health.
8. Startup recovery returns stale `uploading` rows to `retry_wait`.

This is a deliberate small step beyond today’s fire-and-forget promises. It provides restart safety without introducing Redis. If StackPress later runs multiple replicas or high upload volume, the same records can be claimed by a dedicated worker with stronger database locking.

### Retention and deletion

Current `enforceRetention()` deletes local files and then deletes the `BackupJob`. `POST app/api/backups/[id]/delete/route.ts` does the same for manual deletion. Cascading a `BackupJob` deletion immediately would erase the metadata needed to remove remote objects.

The smallest safe policy is:

- local retention remains unchanged by default;
- cloud retention is initially “mirror local deletion” or “keep cloud copy,” selected per connection;
- if mirroring, schedule remote deletion before deleting the final upload metadata;
- if remote deletion fails, retain a tombstone/upload record so the operation can be retried;
- do not block local disk cleanup indefinitely because a cloud API is unavailable.

This requires extracting backup deletion into a service used by both `enforceRetention()` and the delete API. It does not require changing how backups are created.

### UI and API additions

Minimal UI:

- Add a “Cloud Storage” section to the existing settings page for connection setup, OAuth connection state, health test, and default behavior.
- Add a per-site list of enabled cloud destinations to `SiteForm`.
- Add upload rows/statuses to the existing backup detail page.
- Add a compact cloud-copy summary to the backup list.
- Add “Retry upload” for failed copies.

Minimal API surface:

- CRUD/test routes for cloud connections;
- provider-specific OAuth start and callback routes for Google Drive;
- per-site destination assignment route or inclusion in the existing site payload;
- retry endpoint for one `BackupUpload`.

The OAuth callback must store credentials server-side and redirect to settings. Tokens must never be returned to client components.

## Google provider note

Earlier requirements name Google Drive, while “Google Cloud” can also mean Google Cloud Storage. These are different APIs, authentication models, and remote object semantics.

This audit assumes **Google Drive** is the first provider because it was explicitly listed as the intended future destination. If the target is **Google Cloud Storage**, keep the same `CloudStorageConnection`, `SiteCloudDestination`, `BackupUpload`, and provider registry design, but implement a `google_cloud_storage` adapter instead of `google_drive`.

## Recommended implementation sequence

1. Add the three cloud database models and encrypted credential support.
2. Add provider-neutral types, registry, upload naming, and a Google adapter.
3. Add SHA-256 generation and backward-compatible manifest versioning.
4. Add the durable `BackupUpload` poller and post-success dispatch hook.
5. Add connection/OAuth settings UI and API routes.
6. Add per-site destination selection.
7. Show copy status and retry controls on existing backup pages.
8. Centralize deletion and add explicit cloud retention behavior.
9. Add download-before-restore only after upload reliability is established.

## Non-goals for the first cloud release

- Replacing `runBackup()`.
- Treating local filesystem storage as a provider.
- Repackaging backups into a new archive format.
- Requiring Redis, a message broker, or a separate worker container.
- Making local backup success depend on cloud availability.
- Restoring directly from a cloud stream.
- Supporting every provider before the Google adapter is proven.

## Final recommendation

Preserve `runBackup()` as the reliable local recovery-point producer. Add cloud as durable, observable replication after local success. The key architectural separation is not “local provider versus cloud provider”; it is “backup creation versus backup copy.” That boundary matches the current repository, minimizes regression risk, and leaves room for Google Drive, Dropbox, S3-compatible services, OneDrive, SMB, and SFTP adapters later.
