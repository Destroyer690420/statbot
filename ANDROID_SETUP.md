# Send GoPartTime tasks from your phone (Edge Canary)

This lets you send the open task to your Discord ticket from your Android
phone, exactly like the PC flow. It uses **Microsoft Edge Canary + Tampermonkey**
running the same userscript as the desktop.

## One-time setup

### 1. Install Edge Canary
Play Store → search **"Microsoft Edge Canary"** (publisher: Microsoft
Corporation — not the regular "Edge") → Install.

### 2. Open its extensions
Open Edge Canary → tap the **☰ menu** → **Extensions** → **Manage Extensions**.

### 3. Install Tampermonkey
Tap **Get** next to **Tampermonkey** → confirm. It then appears in the menu.

### 4. Install the sender script
In Edge Canary, open this link (tap it — Tampermonkey will grab it):

```
https://statbot.duckdns.org/goparttime-send.user.js
```

→ On Tampermonkey's install page tap **Install**.

### 5. Add your API key (once)
1. In Edge Canary open `https://goparttime.net` and log in.
2. Open any task → tap the round **📤** button (bottom-right of the page).
3. Tap **⚙️** in the dialog. Two prompts appear:
   - **API URL**: leave the default (auto-completes to
     `https://statbot.duckdns.org/api/v1/goparttime`) → OK.
   - **API Key**: paste your key (same `GOPARTTIME_API_KEY` used on PC) → OK.

## Daily use

1. Open a task on goparttime.net → tap **📤**.
2. The dialog shows the detected task (`Task #1234 — Post`) and your tickets.
3. Pick the ticket → **Send** → confirm in your Discord ticket.

Always use **Edge Canary** for goparttime.net — the script only runs there.

## Updating the script

When the extraction logic is fixed/updated, re-open the install link
(step 4) — Tampermonkey replaces the old version.

## If a task isn't detected correctly

Tap **🔍 Debug** in the dialog, copy what it shows (console + alert), and
share it. That output tells which field/selector is missing so the script can
be fixed.

## Debugging commands

`🔍` in the dialog reports detected values (task ID, type, deadline, payment,
title, content length, image count). Use this to show what the phone sees.