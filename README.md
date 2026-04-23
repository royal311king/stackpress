# StackPress

Self-Hosted WordPress Stack Manager

StackPress is a homelab-first backup and restore control panel for Docker-based WordPress sites. It is designed for local infrastructure such as Mac Mini clusters, mounted external drives, and future NVMe-backed storage while staying simple enough to run as a single Docker container.

## MVP Architecture

- Frontend: Next.js App Router with TypeScript and Tailwind CSS.
- Backend: Next.js API routes plus a lightweight custom Node server that also starts the scheduler loop.
- Database: Prisma ORM with a local SQLite file.
- Storage: local filesystem for SQL dumps, tar archives, manifests, and app logs.
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
2. Stop the configured WordPress and DB containers.
3. Extract archived site files.
4. Start the DB container.
5. Pipe the SQL dump back into MySQL.
6. Restart the DB and WordPress containers.

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

- Add and edit sites manually.
- Auto-detect common Docker settings from `docker-compose.yml`.
- Run on-demand backups.
- View backup history with progress status.
- Restore latest or selected backups.
- Delete backup records and files.
- Configure per-site retention and schedule settings.
- Run scheduled backups with an in-process scheduler.
- Store logs locally and display them in the UI.

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

Open [http://localhost:3000](http://localhost:3000).

## Docker Usage

### Run with Docker Compose

```bash
docker compose up -d --build
```

Then open [http://localhost:3000](http://localhost:3000).

### Why the Docker socket is mounted

StackPress runs `docker exec`, `docker cp`, `docker stop`, and `docker start` against your existing WordPress stacks, so the container needs access to the host Docker daemon through `/var/run/docker.sock`.
StackPress also ships with a Linux Docker CLI inside the image, which avoids relying on host binaries and keeps the container behavior consistent on Apple Silicon.

## Persistent Data

- `./data` stores the SQLite database.
- `./storage` stores backup outputs by site.
- `./logs` stores the JSON line application log.

## Example Site Configuration

- Site directory: `/Users/<user>/docker/wp/sites/<site-name>`
- WordPress container: `wp-<site>`
- DB container: `wpdb-<site>`
- DB name: `wpdb`
- DB user: `wpuser`
- DB password: `wppass123`
- Backup destination: `/Volumes/M1-HL-BAKUP/--- LOCAL WEBSITE BACKUPS ---/`

## Notes and Known MVP Limits

- The restore flow operates on the configured WordPress and DB container names directly.
- DB restore expects a MySQL client inside the DB container.
- Disk-space safety currently checks host memory and validates configured paths, but a richer free-space check would be a good next iteration.
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
