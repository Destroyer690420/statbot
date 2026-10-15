# -----------------------------------------------------------------------------
# Isolated sidecar browser (IndiaMART tabs + noVNC viewer).
#
# Deliberately BORING: Alpine + system Chromium under Xvfb, one window
# manager, x11vnc on localhost, websockify bridging it to :6080 for the
# dashboard nginx (`/browser/`). No Playwright, no Selenium, no desktop
# environment — every package below earns its megabytes.
#
# Memory posture: compose caps this box at 1536m with oom_score_adj 500, so
# under pressure the kernel kills THE BROWSER first and the bot never notices.
# -----------------------------------------------------------------------------
FROM alpine:3.20

RUN apk add --no-cache \
    chromium \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    curl \
    unzip \
    ttf-dejavu \
  && rm -rf /var/cache/apk/*

# Tampermonkey (stable) unpacked for --load-extension. Pinned by extension ID
# (dhdgffkkebhmkfjojejmpbldmpobfkfo); Google serves the current stable build.
# Build fails loudly here (not silently browser-without-TM) if the download
# or unpack breaks, so a bad fetch can never ship a TM-less image as "fine".
ARG TM_CRX_URL="https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0&acceptformat=crx2,crx3&x=id%3Ddhdgffkkebhmkfjojejmpbldmpobfkfo%26uc"
# NOTE: unzip exits 1 on .crx files ("extra bytes at beginning") even when it
# extracts everything perfectly — so its exit code is ignored and the content
# tests below are the real gate. A genuinely broken download fails those.
RUN curl -fsSL --retry 3 --max-time 120 "$TM_CRX_URL" -o /tmp/tm.crx \
  && mkdir -p /opt/tm \
  && (unzip -o -q /tmp/tm.crx -d /opt/tm || true) \
  && rm -f /tmp/tm.crx \
  && test -f /opt/tm/manifest.json \
  && test -f /opt/tm/background.js \
  && test -d /opt/tm/_locales \
  && grep -rqi tampermonkey /opt/tm/_locales/en/messages.json

# Wherever the Alpine novnc package drops vnc.html, expose it at /opt/novnc
# for websockify --web. Fails the build if the package layout ever changes.
RUN NOVNC_DIR="$(dirname "$(find /usr/share -maxdepth 3 -name vnc.html 2>/dev/null | head -1)")" \
  && test -n "$NOVNC_DIR" \
  && ln -s "$NOVNC_DIR" /opt/novnc \
  && test -f /opt/novnc/vnc.html \
  && echo "novnc at $NOVNC_DIR"

COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Chrome profile (login session, Tampermonkey scripts/settings) lives on a
# named volume so logins survive container recreates and image rebuilds.
VOLUME /home/chrome
EXPOSE 6080

CMD ["/usr/local/bin/start.sh"]
