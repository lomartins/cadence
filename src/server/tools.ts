import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Intensity, PlaybackState, VibeSlug } from "../shared/types.js";
import * as H from "./handlers.js";
import { loadCuration, vibeDef } from "../data/curation.js";

const VIBES = [
  "deep-focus",
  "steady-flow",
  "wordless-write",
  "open-think",
  "calm-read",
  "alert-study",
  "momentum",
  "decompress",
  "drive",
] as const;

const vibeEnum = z.enum(VIBES);
const intensitySchema = z.number().int().min(0).max(4);

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function fmtPlayback(p: PlaybackState): string {
  const lines: string[] = [];
  if (p.message) lines.push(p.message);
  if (p.track?.title) lines.push(`Now: ${p.track.title}${p.track.artist ? " — " + p.track.artist : ""}`);
  lines.push(
    `vibe ${vibeDef(p.vibe).label} · intensity ${p.intensity} · backend ${p.backend} · auto-switch ${p.auto_switch ? "on" : "off"}`,
  );
  return lines.join("\n");
}

export function registerTools(server: McpServer): void {
  const S = H.SESSION;

  server.tool(
    "connect",
    "Connect Cadence to your Spotify account (OAuth). Optionally pass a redirect URL to finish a headless/SSH login.",
    { redirect_url: z.string().optional() },
    async ({ redirect_url }) => text(await H.doConnect(redirect_url)),
  );

  server.tool("disconnect", "Disconnect from Spotify and clear stored tokens.", {}, async () =>
    text(await H.doDisconnect()),
  );

  server.tool("status", "Show Cadence status: connection, current vibe, backend, auto-switch.", {}, async () => {
    const st = await H.doStatus(S);
    return text(
      `${st.connected ? "✅ Connected" : "⚠️ Not connected"} to Spotify\n` + fmtPlayback(st),
    );
  });

  server.tool(
    "play",
    "Start focus music. Optionally force a vibe and/or intensity (0-4).",
    { vibe: vibeEnum.optional(), intensity: intensitySchema.optional() },
    async ({ vibe, intensity }) =>
      text(fmtPlayback(await H.doPlay(S, vibe as VibeSlug | undefined, intensity as Intensity | undefined))),
  );

  server.tool("pause", "Pause playback.", {}, async () => text(`Paused (${await H.doPause()}).`));
  server.tool("resume", "Resume playback.", {}, async () => text(`Resumed (${await H.doResume()}).`));
  server.tool("skip", "Skip to the next track (logs a soft skip signal).", {}, async () =>
    text(`Skipped (${await H.doSkip(S)}).`),
  );
  server.tool("prev", "Go to the previous track.", {}, async () => text(`Previous (${await H.doPrev()}).`));

  server.tool(
    "set_vibe",
    "Switch to a specific vibe and start playing it.",
    { vibe: vibeEnum, intensity: intensitySchema.optional() },
    async ({ vibe, intensity }) =>
      text(fmtPlayback(await H.doSetVibe(S, vibe as VibeSlug, intensity as Intensity | undefined))),
  );

  server.tool(
    "set_intensity",
    "Set the energy intensity (0 minimal … 4 peak) for the current vibe.",
    { intensity: intensitySchema },
    async ({ intensity }) => {
      H.doSetIntensity(S, intensity as Intensity);
      return text(`Intensity set to ${intensity}.`);
    },
  );

  server.tool(
    "auto",
    "Turn automatic work-mode music switching on, off, or toggle it.",
    { mode: z.enum(["on", "off", "toggle"]) },
    async ({ mode }) => text(`Auto-switch is now ${H.doAuto(S, mode) ? "on" : "off"}.`),
  );

  server.tool("now_playing", "What's playing right now.", {}, async () => {
    const st = await H.doStatus(S);
    if (!st.track?.title) return text("Nothing playing.");
    return text(`🎧 ${st.track.title}${st.track.artist ? " — " + st.track.artist : ""} (${st.backend})`);
  });

  server.tool(
    "feedback",
    "Teach Cadence your taste for the current track: love, like, dislike, ban, or more_like_this.",
    { kind: z.enum(["love", "like", "dislike", "ban", "more_like_this"]) },
    async ({ kind }) => text(await H.doFeedback(S, kind)),
  );

  server.tool("list_vibes", "List the available vibes and what work modes they suit.", {}, async () => {
    const c = loadCuration();
    const lines = VIBES.map((v) => {
      const d = c.vibes[v];
      return `• ${v} — ${d.label}: ${d.workModes.join(", ")} (intensity ${d.defaultIntensity})`;
    });
    return text("Vibes:\n" + lines.join("\n"));
  });

  server.tool(
    "export",
    "Export learned preferences as a portable JSON bundle. Spotify tokens are always excluded. With include_feedback (default true) the bundle also contains your full feedback history — track/artist URIs, time-of-day, and titles if store_track_titles is on; pass include_feedback:false for a PII-light bundle.",
    { include_feedback: z.boolean().optional() },
    async ({ include_feedback }) => text(JSON.stringify(await H.doExport(include_feedback ?? true), null, 2)),
  );

  server.tool(
    "reset",
    "Reset learned preferences for one vibe or all of them.",
    { target: z.union([z.literal("all"), vibeEnum]) },
    async ({ target }) => text(await H.doReset(target as "all" | VibeSlug)),
  );

  server.tool(
    "forget",
    "Forget a specific track or artist URI from all learning and ban lists.",
    { uri: z.string() },
    async ({ uri }) => text(await H.doForget(uri)),
  );

  server.tool("rebuild", "Deterministically rebuild the model from the feedback log.", {}, async () =>
    text(await H.doRebuild()),
  );
}
