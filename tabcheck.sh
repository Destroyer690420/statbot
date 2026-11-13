#!/bin/sh
cd /home/ubuntu/rtm
date -u
DBURL=$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"' | sed 's/host.docker.internal/localhost/')
psql "$DBURL" -tAc 'SELECT id, version, to_char("lastSeenAt",'"'"'HH24:MI:SS'"'"'), to_char("updatedAt",'"'"'HH24:MI:SS'"'"') FROM "CompanionStatus";'
echo '--- version transitions (latest 10) ---'
docker compose logs app 2>/dev/null | grep -a 'Companion watcher version' | tail -10
