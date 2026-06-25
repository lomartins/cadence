# Cadence — Architecture

## One brain, thin clients

Cadence is a Claude Code plugin with a single source of truth: a bundled **stdio
MCP server** (`dist/server/index.mjs`) that owns *all* logic — OAuth, state, the
curation map, the learning model, Spotify calls, and the local-player fallback.

Everything else is a thin client:

- **Slash commands** (`/cadence`, `/focus`, `/vibe`) route to `mcp__cadence__*`
  tools through Claude.
- **Hooks** push lightweight signals to the brain over a local Unix socket and
  exit in milliseconds, so they never block a Claude Code turn.

```
.mcp.json ──launches──▶ MCP server (the brain)
                          ├─ MCP tools  ◀── slash commands (via Claude)
                          └─ Unix socket ◀── hook dispatcher (fire-and-forget)
```

## Process & IPC model

The MCP server is launched once per Claude Code session via `.mcp.json`. On boot
it:

1. loads `config.json` + `state.json` (`src/server/handlers.ts#init`),
2. opens a Unix domain socket at `$CLAUDE_PLUGIN_DATA/cadence.sock`
   (`src/server/ipc-listener.ts`),
3. drains any spooled hook events buffered before it was ready.

Hooks (`hooks/hooks.json`) run `dist/hooks/dispatch.mjs`, which reads the hook's
stdin JSON, connects to the socket, writes one newline-delimited JSON message,
and exits. If the socket isn't up yet (SessionStart can fire before MCP
connects), it appends to `spool.jsonl` instead — nothing is lost, nothing blocks.

`SessionStart` is the one hook that needs a *response*: it asks the brain for a
now-playing banner and prints it to stdout, which Claude Code injects as context.

Because one server process serves one session, all session state is keyed by a
single constant (`handlers.SESSION`), so hook-driven detection and tool-driven
commands share the same session.

## Modules

| Area | Files | Responsibility |
|------|-------|----------------|
| Shared | `src/shared/*` | types contract, path resolution, atomic IO + mutex, IPC framing, logging |
| Config | `src/config/*` | defaults + load/merge (`config.json` ← defaults ← env from `.mcp.json`) |
| Curation | `src/data/presets.json`, `curation.ts` | 9-vibe map, intensity logic, preset audio centroids |
| Spotify | `src/spotify/*` | PKCE auth, token manager, keychain secrets, API client, search, library, player, local fallback |
| Learning | `src/learn/*` | scoring model, signals, cold-start, ranker, persistent store + fold/rebuild |
| Detection | `src/detect/*` | heuristic work-mode classifier, per-session auto-switch gating |
| Server | `src/server/*` | MCP entrypoint, tool definitions, IPC listener, handler glue |
| Hooks | `src/hooks/dispatch.ts` | non-blocking hook client |

## Auth (OAuth Authorization Code + PKCE)

No client secret. `src/spotify/auth.ts` starts a loopback listener on
`127.0.0.1:<ephemeral>/callback`, opens the browser (and always prints the URL
for headless/SSH), captures the code, and exchanges it for tokens. The redirect
URI is registered in the dashboard **without a port** (loopback privilege).

- Access token (1h) lives in memory; refreshed proactively at ~60s-to-expiry and
  reactively on a 401 (`src/spotify/tokens.ts`, `client.ts`).
- Refresh token (~6 months) is stored via `keytar` (OS keychain), falling back to
  a `0600` file (`src/spotify/secrets.ts`). On `invalid_grant` the user re-auths.
- Headless fallback: `/cadence connect <pasted-redirect-url>` completes the flow
  manually.

## Discovery (designed around the 2026 deprecations)

Recommendations, audio-features, related-artists, top-tracks, batch fetches, and
editorial-playlist contents are unavailable to new apps. Cadence uses only the
surviving surface:

- **Search** (`src/spotify/search.ts`) with `genre:`/`year:` filters, capped at
  `limit=10`, paginated — driven by each vibe's curated queries + intensity.
- **User library** (`src/spotify/library.ts`): top artists/tracks, recently
  played, saved tracks; artist genres fetched one-at-a-time and cached.
- Curated playlist names are resolved *best-effort* via search; never assumed
  fetchable.

Premium-gated control degrades to `playerctl`/AppleScript
(`src/spotify/local.ts`) through a unified facade (`src/player/controller.ts`).

## Learning model (deterministic, local, no ML)

`feedback.jsonl` (append-only) is the source of truth; `state.json` is a
rebuildable fold over it (`src/learn/store.ts#rebuild` proves it).

- **Per-vibe profiles**: artist/genre/track `Score{score∈[-1,1], n, last}`, an
  audio-intent centroid (Welford mean/var, seeded from presets), a 24-bucket
  time-of-day histogram, bans.
- **Updates** (`model.ts`): time-decay the prior score, then a confidence-weighted
  step (`lr = max(0.05, 1/(n+1))`). Positive signals also nudge the centroid.
- **Ranking** (`model.ts#componentScores`): explainable weighted sum of track /
  artist / genre / audio-fit / recency / time-of-day, plus a novelty term.
- **Selection** (`ranker.ts`): epsilon-greedy explore/exploit (epsilon annealed by
  mode maturity) with a per-artist diversity cap; banned items hard-filtered.
- **Cold start** (`coldstart.ts`): preset genre priors + centroids, optionally
  warmed from the user's Spotify top artists/genres/saved on first run.

All tunables (weights, deltas, thresholds, decay, epsilon, auto-switch
debounce/confidence, privacy) live in `config.json`.

## Detection & auto-switch

`detect/classifier.ts` scores the prompt text + tool name + file extension
against keyword rules to pick a work mode and a confidence. `detect/session.ts`
gates an actual switch on: auto-switch enabled, the vibe genuinely changed,
confidence ≥ threshold (default 0.6), and a debounce window (default 90s) since
the last switch — so the music never thrashes mid-task.

## Storage layout (`$CLAUDE_PLUGIN_DATA`, survives updates)

```
config.json        # tunables (created from defaults on first run)
state.json         # learned model (a fold over the feedback log)
feedback.jsonl     # append-only event log (source of truth)
credentials.json   # 0600 fallback when no OS keychain (else keychain)
cache/             # artist-genre + playlist-id caches
cadence.sock       # hook ↔ brain IPC
spool.jsonl        # events buffered before the brain is up
cadence.log        # debug log (when config.debug = true)
```

State never lives under `$CLAUDE_PLUGIN_ROOT` (it changes every update).

## Build & distribution

`build.mjs` bundles the server and hook dispatcher into self-contained ESM under
`dist/` with esbuild (`keytar` left external/optional, `presets.json` inlined).
`dist/` is committed so the plugin installs from the marketplace with no build
step.
