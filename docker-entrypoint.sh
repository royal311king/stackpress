#!/bin/sh
set -eu

mkdir -p /app/data /app/logs /app/storage

if [ ! -f /app/data/stackpress.db ] && [ -f /opt/stackpress-seed/stackpress.db ]; then
  cp /opt/stackpress-seed/stackpress.db /app/data/stackpress.db
fi

npx prisma db push --skip-generate

exec "$@"
