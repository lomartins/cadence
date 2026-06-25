---
description: Quick-switch to a Cadence vibe.
argument-hint: "[deep-focus|steady-flow|wordless-write|open-think|calm-read|alert-study|momentum|decompress|drive]"
allowed-tools: mcp__cadence__set_vibe, mcp__cadence__list_vibes
---

The user invoked `/cadence:vibe` with arguments: `$ARGUMENTS`

- If a valid vibe slug is provided, call `mcp__cadence__set_vibe` with that `vibe`.
- If no argument or an unknown one, call `mcp__cadence__list_vibes` and show the options.

Vibe slugs: `deep-focus`, `steady-flow`, `wordless-write`, `open-think`, `calm-read`, `alert-study`, `momentum`, `decompress`, `drive`.
