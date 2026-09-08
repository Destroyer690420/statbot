#!/bin/sh
# Container entrypoint: virtual display for the headful poller browser,
# then the app. Xvfb is cheap (~30MB) and makes Chromium look like a real
# desktop to bot management (headless signals are scored harshly).
set -e
if [ -z "$NO_XVFB" ]; then
  rm -f /tmp/.X99-lock
  Xvfb :99 -screen 0 1366x768x24 >/tmp/xvfb.log 2>&1 &
  export DISPLAY=:99
fi
exec node dist/index.js
