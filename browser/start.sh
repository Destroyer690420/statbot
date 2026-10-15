#!/bin/sh
# Sidecar browser supervisor. One virtual screen, one window manager, one VNC
# server (localhost-only), one websockify bridge, one Chrome kept alive.
#
# Nothing here phones home and nothing touches the bot: this box shares only
# the docker network (so nginx can proxy it) and its own named volume.
set -eu

: "${BROWSER_VNC_PASSWORD:?BROWSER_VNC_PASSWORD must be set in .env}"
: "${BROWSER_START_URLS:=https://seller.indiamart.com/bltxn/?pref=recent https://seller.indiamart.com/bltxn/?pref=relevant}"
: "${BROWSER_SCREEN:=1366x768x24}"
: "${BROWSER_DISPLAY:=:99}"

export DISPLAY="$BROWSER_DISPLAY"
PROFILE=/home/chrome/profile
mkdir -p "$PROFILE" /home/chrome/.vnc

# x11vnc refuses short passwords; ours is generated long — fail fast otherwise.
x11vnc -storepasswd "$BROWSER_VNC_PASSWORD" /home/chrome/.vnc/passwd
chmod 600 /home/chrome/.vnc/passwd

Xvfb "$BROWSER_DISPLAY" -screen 0 "$BROWSER_SCREEN" +extension RANDR &
sleep 1
fluxbox -display "$BROWSER_DISPLAY" > /tmp/fluxbox.log 2>&1 &
x11vnc -display "$BROWSER_DISPLAY" -rfbauth /home/chrome/.vnc/passwd \
  -localhost -shared -forever -bg -o /tmp/x11vnc.log
websockify --web /opt/novnc 6080 localhost:5900 > /tmp/websockify.log 2>&1 &

CHROME_FLAGS="--no-sandbox --disable-dev-shm-usage --disable-gpu \
  --no-first-run --no-default-browser-check --password-store=basic \
  --disable-crash-reporter --disable-features=Translate,OptimizationHints \
  --user-data-dir=$PROFILE --window-size=1366,768 --window-position=0,0"

# shellcheck disable=SC2086
if [ -d /opt/tm ]; then
  CHROME_FLAGS="$CHROME_FLAGS --load-extension=/opt/tm"
fi

echo "browser box up: display=$BROWSER_DISPLAY urls=$BROWSER_START_URLS"

# Keep exactly one Chrome alive forever: tabs crash, sites kill renderers,
# users close windows from the viewer — the loop just brings it back.
# shellcheck disable=SC2086
while true; do
  # shellcheck disable=SC2086
  chromium-browser $CHROME_FLAGS $BROWSER_START_URLS || true
  echo "$(date -u +%FT%TZ) chrome exited, relaunching in 10s"
  sleep 10
done
