---
description: Connect Cadence to your Spotify account (opens browser, waits for the callback, then shows status).
argument-hint: "[paste-redirect-url for headless/SSH]"
allowed-tools: mcp__cadence__connect
---

The user invoked `/cadence:connect` with arguments: `$ARGUMENTS`

Call `mcp__cadence__connect`. If a redirect URL was pasted (headless/SSH flow), pass it as the `redirect_url` argument; otherwise call with no arguments. The tool opens the browser, waits for the OAuth callback, and returns the final connection status — report that result to the user verbatim.
