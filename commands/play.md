---
description: Start focus music for the current task. Optionally force a vibe and intensity.
argument-hint: "[vibe-slug] [intensity 0-4]"
allowed-tools: mcp__cadence__play
---

The user invoked `/cadence:play` with arguments: `$ARGUMENTS`

Call `mcp__cadence__play`. If a vibe slug is given, pass it as `vibe`; if a number 0-4 is given, pass it as `intensity`. With no arguments, call it bare to play for the current detected work mode. Report what started.
