---
name: cadence
description: Focus-music control and work-mode detection for Claude Code. Use when the user asks to play/pause/skip music, change the vibe or intensity, connect Spotify, give music feedback (love/like/dislike/ban/more), toggle auto-switching, or asks what's playing. Cadence matches Spotify music to the current coding task to keep the user focused.
---

# Cadence — focus music for Claude Code

Cadence plays Spotify music matched to the user's current work mode and learns
their taste over time. A bundled MCP server (`cadence`) is the brain; you control
it through `mcp__cadence__*` tools. Hooks detect the work mode automatically in
the background — you usually don't need to.

## When to act

- "play music / start focus / put something on" → `mcp__cadence__play`
- "pause / stop the music" → `mcp__cadence__pause`; "resume" → `mcp__cadence__resume`
- "skip / next" → `mcp__cadence__skip`; "previous" → `mcp__cadence__prev`
- "this is great / I love this" → `mcp__cadence__feedback` kind `love`
- "meh / skip these / not this" → `feedback` kind `dislike`; "never play this" → `ban`
- "more like this" → `feedback` kind `more_like_this`
- "switch to <vibe> / something calmer / more energy" → `mcp__cadence__set_vibe`
  or `mcp__cadence__set_intensity` (0 minimal … 4 peak)
- "stop changing the music / let it switch on its own" → `mcp__cadence__auto`
- "what's playing" → `mcp__cadence__now_playing`
- "connect spotify" → `mcp__cadence__connect`

Prefer calling the tool over describing it. Keep confirmations to one line.

## Vibe taxonomy (work mode → vibe)

| vibe | label | suits |
|------|-------|-------|
| `deep-focus` | Deep Focus | implementation / deep-focus coding |
| `steady-flow` | Steady Flow | debugging |
| `wordless-write` | Wordless Writing | writing & docs (no lyrics) |
| `open-think` | Open Thinking | planning / architecture |
| `calm-read` | Calm Reading | code review / reading |
| `alert-study` | Alert Study | learning / research |
| `momentum` | Momentum | repetitive / mechanical work |
| `decompress` | Decompress | breaks |
| `drive` | Drive | crunch / high-pressure shipping |

## How learning works

Every love/like/dislike/ban/more and every skip/complete is appended to a local
feedback log and folded into per-vibe preference profiles (artist/genre/track
scores, an audio-intent centroid, time-of-day). Ranking is epsilon-greedy so it
explores without going stale. Everything is local; nothing is sent anywhere
except the user's own authenticated Spotify API. `mcp__cadence__rebuild`
recomputes the model from the log; `mcp__cadence__reset` wipes it.

## Setup notes (mention only if relevant)

- The user needs their own Spotify app Client ID configured in the plugin
  settings (Spotify dev-mode caps an app at 5 users, so each user supplies their
  own). In the Spotify app settings the **Redirect URI must be exactly**
  `http://127.0.0.1:8888/callback` (loopback IPv4 — `localhost` is rejected;
  change the port only via the `auth_port` config). Playback **control** needs
  Spotify Premium; without it, on Linux/macOS Cadence falls back to controlling
  the desktop Spotify app (play/pause/next).
- First run: `/cadence connect` to authorize.
