---
description: Control Cadence focus music — connect, play, switch vibe, give feedback, tune learning.
argument-hint: "[connect|status|play|pause|resume|skip|prev|vibe <slug>|intensity <0-4>|auto on|off|toggle|love|like|dislike|ban|more|list|export|reset <all|vibe>|forget <uri>|rebuild|disconnect]"
allowed-tools: mcp__cadence__connect, mcp__cadence__disconnect, mcp__cadence__status, mcp__cadence__play, mcp__cadence__pause, mcp__cadence__resume, mcp__cadence__skip, mcp__cadence__prev, mcp__cadence__set_vibe, mcp__cadence__set_intensity, mcp__cadence__auto, mcp__cadence__now_playing, mcp__cadence__feedback, mcp__cadence__list_vibes, mcp__cadence__export, mcp__cadence__reset, mcp__cadence__forget, mcp__cadence__rebuild
---

The user invoked `/cadence` with arguments: `$ARGUMENTS`

Route the request to the matching Cadence MCP tool, then report the tool's result back concisely. Do not call any other tools.

Mapping:
- (empty) or `status` → `mcp__cadence__status`
- `connect` → `mcp__cadence__connect`. If a URL was pasted after `connect`, pass it as `redirect_url`.
- `disconnect` → `mcp__cadence__disconnect`
- `play` → `mcp__cadence__play` (pass `vibe`/`intensity` if given)
- `pause` → `mcp__cadence__pause`
- `resume` → `mcp__cadence__resume`
- `skip` / `next` → `mcp__cadence__skip`
- `prev` / `previous` → `mcp__cadence__prev`
- `vibe <slug>` → `mcp__cadence__set_vibe` with `vibe`
- `intensity <0-4>` → `mcp__cadence__set_intensity`
- `auto on|off|toggle` → `mcp__cadence__auto`
- `nowplaying` / `np` → `mcp__cadence__now_playing`
- `love` / `like` / `dislike` / `ban` / `more` (→ more_like_this) → `mcp__cadence__feedback` with `kind`
- `list` / `vibes` → `mcp__cadence__list_vibes`
- `export` → `mcp__cadence__export`
- `reset <all|vibe-slug>` → `mcp__cadence__reset`
- `forget <uri>` → `mcp__cadence__forget`
- `rebuild` → `mcp__cadence__rebuild`

If the argument is unrecognized, call `mcp__cadence__status` and show the available subcommands above.
