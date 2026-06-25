import type {
  CadenceConfig,
  FeedbackEvent,
  HookEvent,
  Intensity,
  PlaybackState,
  State,
  VibeSlug,
} from "../shared/types.js";
import { loadConfig } from "../config/load.js";
import { setDebug, log } from "../shared/log.js";
import { writeDataDirPointer } from "../shared/paths.js";
import {
  loadState,
  saveState,
  appendFeedback,
  rebuild,
  exportBundle,
  importBundle,
  reset,
  forget,
  type ExportBundle,
} from "../learn/store.js";
import { warmFromSpotify } from "../learn/coldstart.js";
import { hasRefreshToken, logout } from "../spotify/tokens.js";
import { beginAuth, completeWithRedirectUrl } from "../spotify/auth.js";
import { clientId } from "../config/load.js";
import {
  getSession,
  setAuto,
  setVibe,
  setIntensity,
  shouldSwitch,
  applySwitch,
} from "../detect/session.js";
import { classify } from "../detect/classifier.js";
import * as controller from "../player/controller.js";
import { defaultIntensity, vibeDef } from "../data/curation.js";

// One MCP server process serves one Claude Code session, so hook-driven
// detection and tool-driven commands share a single in-process session key.
export const SESSION = "primary";

let cfg: CadenceConfig;
let state: State;

export async function init(): Promise<void> {
  cfg = await loadConfig();
  setDebug(cfg.debug);
  // record the resolved data dir so the fast hook dispatcher finds the same socket
  writeDataDirPointer();
  state = await loadState();
  log("info", "cadence brain initialized");
  // warm from Spotify on first ever run if already connected
  if (state.created_at === state.updated_at && (await hasRefreshToken())) {
    warmFromSpotify(state, cfg)
      .then(() => saveState(state))
      .catch(() => {});
  }
}

export function config(): CadenceConfig {
  return cfg;
}

function nowHour(): number {
  return new Date().getHours();
}

// ---- connection ----
export async function doConnect(redirectUrl?: string): Promise<string> {
  if (!clientId()) {
    return "No Spotify Client ID configured. Set `spotify_client_id` in the plugin config (see README) and reconnect.";
  }
  if (redirectUrl) {
    await completeWithRedirectUrl(redirectUrl);
    return "✅ Connected to Spotify.";
  }
  try {
    const handle = await beginAuth(cfg.auth_port);
    // wait briefly for the loopback callback; if it doesn't arrive, hand back the URL
    const settled = await Promise.race([
      handle.done.then(() => "done").catch((e) => `err:${e}`),
      new Promise<string>((r) => setTimeout(() => r("pending"), 2500)),
    ]);
    if (settled === "done") return "✅ Connected to Spotify. Try `/cadence play`.";
    if (typeof settled === "string" && settled.startsWith("err:")) {
      return `Authorization failed: ${settled.slice(4)}\nOpen this URL manually:\n${handle.url}`;
    }
    // still pending: keep listening in the background and give the user the link
    handle.done
      .then(() => log("info", "auth completed after handoff"))
      .catch((e) => log("warn", "auth handoff failed", String(e)));
    return `Opening your browser to authorize Spotify. If it didn't open, visit:\n${handle.url}\n\nAfter you click "Agree", it completes automatically — you'll see a "Cadence is connected" page. Then run /cadence status to confirm and /cadence play to start.\n\nRedirect URI in your Spotify app must be exactly: http://127.0.0.1:${cfg.auth_port}/callback (loopback IPv4, NOT localhost).\n\nHeadless/SSH (browser can't reach this machine)? Copy the full redirected URL from the address bar and run:\n/cadence connect <paste-url-here>`;
  } catch (e) {
    return `Could not start authorization: ${String(e)}`;
  }
}

export async function doDisconnect(): Promise<string> {
  await logout();
  return "Disconnected from Spotify and cleared stored tokens.";
}

// ---- playback ----
export async function doPlay(
  sessionId: string,
  vibe?: VibeSlug,
  intensity?: Intensity,
): Promise<PlaybackState> {
  const s = getSession(sessionId, cfg);
  if (vibe) setVibe(sessionId, cfg, vibe, intensity);
  else if (intensity !== undefined) setIntensity(sessionId, cfg, intensity);
  return controller.playVibe(cfg, state, s.current_vibe, s.intensity, s.current_mode, false);
}

export async function doPause(): Promise<string> {
  return controller.pause(cfg);
}
export async function doResume(): Promise<string> {
  return controller.resume(cfg);
}
export async function doPrev(): Promise<string> {
  return controller.previous(cfg);
}

export async function doSkip(sessionId: string): Promise<string> {
  // an explicit skip is a weak negative signal on the current track
  await recordFeedback(sessionId, "skip_early", 0.1).catch(() => {});
  return controller.skip(cfg);
}

export async function doSetVibe(sessionId: string, vibe: VibeSlug, intensity?: Intensity): Promise<PlaybackState> {
  setVibe(sessionId, cfg, vibe, intensity);
  return doPlay(sessionId, vibe, intensity);
}

export function doSetIntensity(sessionId: string, intensity: Intensity): void {
  setIntensity(sessionId, cfg, intensity);
}

export function doAuto(sessionId: string, mode: "on" | "off" | "toggle"): boolean {
  return setAuto(sessionId, cfg, mode);
}

// ---- feedback / learning ----
async function recordFeedback(
  sessionId: string,
  event: FeedbackEvent["event"],
  playedFraction?: number,
): Promise<FeedbackEvent | null> {
  const s = getSession(sessionId, cfg);
  const head = controller.getLastQueueHead();
  const np = await controller.nowPlaying(cfg).catch(() => null);
  const uri = np?.track?.uri ?? head?.uri;
  // nothing identifiable playing — don't pollute n_events / histograms with empties
  if (!uri && event !== "ban") return null;
  const ev: FeedbackEvent = {
    ts: new Date().toISOString(),
    mode: s.current_vibe,
    event,
    track: uri,
    artist: head?.artistId ? `spotify:artist:${head.artistId}` : undefined,
    genres: head?.genres,
    title: cfg.privacy.store_track_titles ? np?.track?.title ?? head?.title : undefined,
    played_fraction: playedFraction,
    source: event.startsWith("sp_") ? "spotify" : event.startsWith("skip") || event === "completed" ? "player" : "user",
    hour: nowHour(),
  };
  await appendFeedback(state, ev, cfg);
  return ev;
}

export async function doFeedback(
  sessionId: string,
  kind: "love" | "like" | "dislike" | "ban" | "more_like_this",
): Promise<string> {
  const ev = await recordFeedback(sessionId, kind);
  const label = vibeDef(getSession(sessionId, cfg).current_vibe).label;
  if (!ev?.track && kind !== "ban") return "Nothing is playing to give feedback on.";
  const map: Record<string, string> = {
    love: "❤️ Loved",
    like: "👍 Liked",
    dislike: "👎 Disliked",
    ban: "🚫 Banned",
    more_like_this: "✨ More like this",
  };
  return `${map[kind]} — learned for ${label}.`;
}

// ---- detection / auto-switch (from hooks) ----
export async function doDetectAndSwitch(ev: HookEvent): Promise<string | null> {
  if (ev.kind === "session-end") return null;
  const { workMode, confidence } = classify({
    prompt: ev.prompt,
    tool_name: ev.tool_name,
    tool_input: ev.tool_input,
  });
  const decision = shouldSwitch(SESSION, cfg, workMode, confidence);
  log("debug", "detect", { workMode, confidence, decision });
  if (!decision.switch) return null;

  applySwitch(SESSION, cfg, workMode, decision.vibe);
  const s = getSession(SESSION, cfg);
  const pb = await controller.playVibe(cfg, state, decision.vibe, s.intensity, workMode, true);
  if (pb.is_playing) return `🎚️ Switched to ${vibeDef(decision.vibe).label} for ${workMode}.`;
  return null;
}

// ---- banner for SessionStart ----
export async function buildNowPlayingBanner(sessionId: string): Promise<string> {
  const s = getSession(sessionId, cfg);
  const connected = await hasRefreshToken();
  if (!connected) {
    return "🎧 Cadence: not connected to Spotify. Run /cadence connect to enable focus music.";
  }
  const np = await controller.nowPlaying(cfg).catch(() => null);
  const auto = s.auto_switch ? "on" : "off";
  const vibe = vibeDef(s.current_vibe).label;
  if (np?.track?.title) {
    return `🎧 Cadence: ${np.track.title}${np.track.artist ? " — " + np.track.artist : ""} · vibe: ${vibe} · auto-switch: ${auto}`;
  }
  return `🎧 Cadence ready · vibe: ${vibe} · auto-switch: ${auto}. Use /cadence play to start.`;
}

// ---- status ----
export async function doStatus(sessionId: string): Promise<PlaybackState & { connected: boolean }> {
  const s = getSession(sessionId, cfg);
  const connected = await hasRefreshToken();
  const np = await controller.nowPlaying(cfg).catch(() => null);
  return {
    connected,
    backend: np?.backend ?? "none",
    is_playing: np?.is_playing ?? false,
    vibe: s.current_vibe,
    intensity: s.intensity,
    mode: s.current_mode,
    auto_switch: s.auto_switch,
    track: np?.track,
    needs_auth: !connected,
  };
}

// ---- maintenance ----
export async function doExport(includeFeedback = true): Promise<ExportBundle> {
  return exportBundle(state, includeFeedback);
}
export async function doImport(bundle: ExportBundle): Promise<string> {
  state = await importBundle(bundle);
  return "Imported preferences.";
}
export async function doReset(target: "all" | VibeSlug): Promise<string> {
  state = await reset(target);
  return target === "all" ? "Reset all learned preferences." : `Reset preferences for ${target}.`;
}
export async function doForget(uri: string): Promise<string> {
  state = await forget(state, uri, cfg);
  return `Forgot ${uri}.`;
}
export async function doRebuild(): Promise<string> {
  state = await rebuild(cfg);
  return "Rebuilt model from the feedback log.";
}

export function currentState(): State {
  return state;
}

export { defaultIntensity };
