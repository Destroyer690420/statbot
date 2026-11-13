#!/bin/sh
cd /home/ubuntu/rtm
echo '--- nginx access log location ---'
docker compose exec -T dashboard ls -la /var/log/nginx/ 2>&1 | head -5
echo '--- recent claim polls with versions per tab (last 5 min) ---'
docker compose exec -T dashboard sh -c 'cat /var/log/nginx/access.log 2>/dev/null | grep -a "claims/pending" | tail -40' | grep -a -o -E 'version=[^& ]*|tabId=[^& ]*' | head -40
