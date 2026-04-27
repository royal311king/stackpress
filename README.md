# StackPress

Self-Hosted WordPress Stack Manager

StackPress is a homelab-first backup and restore control panel for Docker-based WordPress sites. It is designed for local infrastructure such as Mac Mini clusters, mounted external drives, and future NVMe-backed storage while staying simple enough to run as a single Docker container.

## MVP Architecture

- Frontend: Next.js App Router with TypeScript and Tailwind CSS.
- Backend: Next.js API routes plus a lightweight custom Node server that also starts the scheduler loop.
- Database: Prisma ORM with a local SQLite file.
- Storage: local filesystem for SQL dumps, tar archives, manifests, safety snapshots, and app logs.
- Scheduler: in-process cron heartbeat that survives app restarts because schedules are stored in SQLite and reloaded on boot.
- Runtime model: one container, no external database, no background worker service.
- Container execution: multi-stage ARM-friendly Docker build with a Linux Docker CLI bundled into the app image.

### Core domain objects

- `Site`: per-WordPress stack configuration, paths, credentials, retention, and schedule settings.
- `BackupJob`: backup history, progress state, outputs, timing, and restore source.
- `AppSetting`: global defaults like timezone, scheduler enabled, and filesystem roots.
- `ActivityLog`: local app event log for dashboard and diagnostics.

### Backup flow

1. Validate site and destination paths.
2. Prevent overlapping backups for the same site.
3. Run `mysqldump` in the configured DB container.
4. Archive the `html/` directory with `tar`.
5. Write a JSON manifest.
6. Persist backup history in SQLite.
7. Enforce retention rules.

### Restore flow

1. Confirm the restore action in the UI.
2. Optionally create a pre-restore safety snapshot.
3. Stop the configured WordPress and DB containers.
4. Extract archived site files.
5. Start the DB container.
6. Pipe the SQL dump back into MySQL.
7. Restart the DB and WordPress containers.

## Project Structure

```text
app/
  (dashboard)/
    page.tsx
    sites/
    backups/
    settings/
    logs/
  api/
components/
lib/
  services/
prisma/
  schema.prisma
data/
storage/
logs/
Dockerfile
docker-compose.yml
server.ts
```

## Features in This MVP

- Add and edit sites manually, including a public Site URL for quick access and health checks.
- Auto-detect common Docker settings from `docker-compose.yml` and `.env` files.
- Run on-demand backups.
- Run a sequential bulk backup for all active configured sites from the dashboard.
- View backup history with progress status.
- Open a detailed backup page with manifests, warnings, retention context, and related logs.
- Restore latest or selected backups.
- Create optional pre-restore safety snapshots.
- Delete backup records and files.
- Configure per-site retention and schedule settings.
- Run scheduled backups with an in-process scheduler.
- Store logs locally and display them in the UI.
- Open a site or WordPress admin directly from site cards and detail pages.
- Run lightweight on-demand HTTP health checks with status code, response time, and last checked time.


### Site access and health checks

Each site can store an optional `Site URL`. StackPress uses it for:

- `Open Site` links
- `Open WP Admin` links using `<siteUrl>/wp-admin`
- manual `Check Now` HTTP health checks

Health checks are intentionally lightweight. They run only when requested, store the latest result on the site record, and report `online`, `down`, or `unknown` with HTTP status, response time, timestamp, and error text when available. Secure one-click WordPress login is intentionally deferred and should be handled later through a StackPress WordPress companion plugin.

### Site setup path handling

StackPress validates paths from the app/runtime point of view. When running in Docker, use the container-mounted path, not the macOS Finder path. For example, if your compose file mounts `/Users/mim1/docker/m1-wp-homelab` as `/mnt/wp-sites`, enter `/mnt/wp-sites/<site-name>` in StackPress.

The Add/Edit Site form includes:

- server-visible Browse buttons for Site Directory, Backup Destination, and Uploads Path
- an Auto-Detect docker-compose flow that lets you select a visible `docker-compose.yml` file
- a Container Path Helper showing mounts StackPress can see
- Test Backup Paths checks for readable site/uploads folders, writable backup destination, Docker containers, and DB credentials
- Create Folder support when the backup destination does not exist

Detection no longer treats homelab defaults as proven facts. If StackPress falls back to values like `wpdb`, `wpuser`, or `wppass123`, the form marks them as fallback guesses and asks you to confirm them before saving.

Backups are standardized under:

```text
<backup-destination>/<site-slug>/stackpress/
  db-YYYY-MM-DD_HH-mm-ss.sql
  files-YYYY-MM-DD_HH-mm-ss.tar.gz
  manifest-YYYY-MM-DD_HH-mm-ss.json
```

Legacy duplicate folders are not deleted automatically. Retention cleanup applies to StackPress-tracked backups in the standardized folder.

### Scheduled backup behavior

- Sites set to `Manual` are never scheduled.
- Scheduled runs use each site's stored timezone when calculating cron and next-run times.
- The UI shows schedule state, next run, last scheduled run, last scheduled result, and backup source.
- Scheduled backups are logged distinctly from manual and bulk-triggered backups.
- Cron expressions are supported, but they must be valid standard cron strings.

### File archive exclusions

File archives skip common volatile WordPress paths to reduce backup size and avoid live-site churn during `tar` creation. Current defaults include cache, upgrade, plugin backup, temporary, session, and log-style folders under `html/wp-content/`.

### Pre-restore safety snapshots

When enabled in the restore modal, StackPress creates a rollback snapshot in:

- `<backup-destination>/<site-slug>/stackpress/pre-restore/`

That snapshot includes:

- `pre-restore-db-YYYY-MM-DD_HH-mm-ss.sql`
- `pre-restore-files-YYYY-MM-DD_HH-mm-ss.tar.gz` when the current `html/` directory is available
- `pre-restore-manifest-YYYY-MM-DD_HH-mm-ss.json`

## Local Development

### Requirements

- Node.js 20.9 or newer.
- Docker CLI and Docker Engine available on the host running StackPress.
- A writable local filesystem for `data/`, `storage/`, and `logs/`.

### Install

```bash
npm ci
cp .env.example .env
npx prisma generate
npx prisma db push
npm run dev
```

### Database migration after pulling updates

When Prisma schema fields change, update the local SQLite database with:

```bash
npx prisma generate
npx prisma db push
```

Docker starts also run `prisma db push --skip-generate` from the entrypoint so existing mounted databases receive additive schema updates.

Open [http://localhost:3000](http://localhost:3000).

## Docker Usage

### Run with Docker Compose

```bash
docker compose up -d --build
```

Then open [http://localhost:3000](http://localhost:3000).

### Docker path visibility

StackPress executes file operations against the paths stored on each site record. If you run StackPress in Docker, the container must be able to see those same host paths.

Typical examples:

- mount your WordPress site root such as `/mnt/wp-sites` into the container at the same absolute path
- mount your backup destination roots such as `/Volumes/M1-HL-BAKUP` into the container at the same absolute path
- keep `/var/run/docker.sock` mounted so StackPress can call `docker exec`, `docker cp`, `docker stop`, and `docker start`

If the container cannot see a configured site path or backup destination path, backups and restores will fail path validation even if those paths exist on the host.

### Why the Docker socket is mounted

StackPress runs `docker exec`, `docker cp`, `docker stop`, and `docker start` against your existing WordPress stacks, so the container needs access to the host Docker daemon through `/var/run/docker.sock`.
StackPress also ships with a Linux Docker CLI inside the image, which avoids relying on host binaries and keeps the container behavior consistent on Apple Silicon.

## Persistent Data

- `./data` stores the SQLite database.
- `./storage` stores backup outputs by site.
- `./logs` stores the JSON line application log.

## Example Site Configuration

- Site directory: `/mnt/wp-sites/<site-name>`
- Alternate site directory: `/Users/<user>/docker/wp/sites/<site-name>`
- WordPress container: `wp-<site>`
- DB container: `wpdb-<site>`
- DB name: `wpdb`
- DB user: `wpuser`
- DB password: `wppass123`
- Backup destination: `/Volumes/M1-HL-BAKUP/--- LOCAL WEBSITE BACKUPS ---/`

## Notes and Known MVP Limits

- The restore flow operates on the configured WordPress and DB container names directly.
- DB restore expects a MySQL client inside the DB container.
- The scheduler is an in-process minute heartbeat, so StackPress must be running for scheduled backups to trigger on time.
- Docker deployments require the container to see the same site and backup paths you configure in the UI.
- Disk-space safety currently checks available space with `df` against the configured backup destination, but a richer storage-health view would be a good next iteration.
- Multi-machine support is not implemented yet, but the data model leaves room for machine identity and remote execution later.

## Run Checklist

1. Build and start:

```bash
docker compose up -d --build
```

2. Verify the container is healthy:

```bash
docker compose ps
docker compose logs -f stackpress
```

3. Open the app:

- URL: [http://localhost:3000](http://localhost:3000)
- You should see the StackPress dashboard and be able to add a site.

## Future-Friendly Extension Points

- Add a `Machine` model and route backups through remote agents.
- Support NVMe media pools and alternate storage classes.
- Add S3 or cloud backup destinations.
- Add WordPress automation tasks beyond backup and restore.
