---
description: Instantly start focus music for the current task (optionally force a vibe + intensity).
argument-hint: "[vibe-slug] [intensity 0-4]"
allowed-tools: mcp__cadence__play, mcp__cadence__set_vibe, mcp__cadence__set_intensity
---

The user invoked `/focus` with arguments: `$ARGUMENTS`

- If a vibe slug is given as the first argument, call `mcp__cadence__set_vibe` with that `vibe` (and `intensity` if a second numeric argument is present).
- If only an intensity number is given, call `mcp__cadence__set_intensity` then `mcp__cadence__play`.
- If no arguments, just call `mcp__cadence__play` to start music for the current detected work mode.

Report the now-playing result concisely.
