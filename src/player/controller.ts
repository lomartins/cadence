import type {
  CadenceConfig,
  Intensity,
  PlaybackState,
  State,
  TrackCandidate,
  VibeSlug,
  WorkMode,
} from "../shared/types.js";
import * as web from "../spotify/player.js";
import * as local from "../spotify/local.js";
import { poolForVibe, resolvePlaylistByName } from "../spotify/search.js";
import { enrichGenres, topTracks } from "../spotify/library.js";
import { PremiumRequiredError, NoActiveDeviceError } from "../spotify/client.js";
import { NeedsAuthError, hasRefreshToken } from "../spotify/tokens.js";
import { rankCandidates, buildQueue } from "../learn/ranker.js";
import { ensureProfile } from "../learn/coldstart.js";
import { vibeDef } from "../data/curation.js";
import { log } from "../shared/log.js";

let lastQueue: TrackCandidate[] = [];

export function getLastQueueHead(): TrackCandidate | undefined {
  return lastQueue[0];
}

// Discover + rank a fresh queue for a vibe/intensity using only surviving APIs.
async function discover(
  cfg: CadenceConfig,
  state: State,
  vibe: VibeSlug,
  intensity: Intensity,
): Promise<TrackCandidate[]> {
  const pool = await poolForVibe(vibe, intensity, cfg.market, 1);

  // sprinkle in a few of the user's own top tracks for personalization
  try {
    const tops = await topTracks("medium_term", 10);
    for (const t of tops) if (!pool.some((p) => p.id === t.id)) pool.push(t);
  } catch {
    /* optional */
  }

  await enrichGenres(pool, 24);
  const profile = ensureProfile(state, vibe);
  const ranked = rankCandidates(pool, profile, state, cfg);
  const queue = buildQueue(ranked, profile, cfg);
  log("info", "discovered queue", { vibe, intensity, pool: pool.length, queue: queue.length });
  return queue;
}

function base(vibe: VibeSlug, intensity: Intensity, mode: WorkMode, auto: boolean): PlaybackState {
  return { backend: "none", is_playing: false, vibe, intensity, mode, auto_switch: auto };
}

async function localFallback(
  result: PlaybackState,
  note: string,
): Promise<PlaybackState> {
  if (await local.available()) {
    await local.play();
    const st = await local.status();
    result.backend = "local";
    result.is_playing = st?.playing ?? true;
    if (st?.title) result.track = { title: st.title, artist: st.artist };
    result.message = `${note} Using local player (no track selection).`;
  } else {
    result.message = `${note} No local player available.`;
  }
  return result;
}

// Start playback for a vibe. Web API when possible (Premium + active device),
// degrading transparently to the local desktop player otherwise.
export async function playVibe(
  cfg: CadenceConfig,
  state: State,
  vibe: VibeSlug,
  intensity: Intensity,
  mode: WorkMode,
  auto = false,
): Promise<PlaybackState> {
  const result = base(vibe, intensity, mode, auto);

  if (!(await hasRefreshToken())) {
    result.needs_auth = true;
    result.message = "Not connected to Spotify. Run /cadence connect.";
    return result;
  }

  try {
    const queue = await discover(cfg, state, vibe, intensity);
    lastQueue = queue;
    if (queue.length > 0) {
      await web.play({ uris: queue.slice(0, 50).map((c) => c.uri) });
      result.backend = "web";
      result.is_playing = true;
      result.track = { uri: queue[0].uri, title: queue[0].title, artist: queue[0].artist };
      result.message = `Playing ${vibeDef(vibe).label} (${queue.length} tracks).`;
      return result;
    }
    // search produced nothing — try a curated playlist context as a last resort
    for (const name of vibeDef(vibe).playlists) {
      const id = await resolvePlaylistByName(name, cfg.market);
      if (id) {
        await web.play({ context_uri: `spotify:playlist:${id}` });
        result.backend = "web";
        result.is_playing = true;
        result.message = `Playing playlist "${name}".`;
        return result;
      }
    }
    result.message = "No tracks found for this vibe.";
    return result;
  } catch (e) {
    if (e instanceof NeedsAuthError) {
      result.needs_auth = true;
      result.message = "Spotify session expired. Run /cadence connect.";
      return result;
    }
    if (e instanceof PremiumRequiredError) {
      result.needs_premium = true;
      if (cfg.enable_local_fallback) return localFallback(result, "Spotify Premium required.");
      result.message = "Spotify Premium required for Web API playback control.";
      return result;
    }
    if (e instanceof NoActiveDeviceError) {
      result.no_device = true;
      if (cfg.enable_local_fallback) return localFallback(result, "No active Spotify device.");
      result.message = "No active Spotify device. Open Spotify on a device and retry.";
      return result;
    }
    log("error", "playVibe failed", String(e));
    if (cfg.enable_local_fallback) return localFallback(result, "Web playback failed.");
    result.message = `Playback failed: ${String(e)}`;
    return result;
  }
}

async function webOrLocal(
  webFn: () => Promise<unknown>,
  localFn: () => Promise<void>,
  cfg: CadenceConfig,
): Promise<"web" | "local" | "none"> {
  try {
    await webFn();
    return "web";
  } catch (e) {
    if ((e instanceof PremiumRequiredError || e instanceof NoActiveDeviceError) && cfg.enable_local_fallback) {
      await localFn();
      return "local";
    }
    if (e instanceof NeedsAuthError) return "none";
    log("warn", "control fell through to local", String(e));
    if (cfg.enable_local_fallback && (await local.available())) {
      await localFn();
      return "local";
    }
    return "none";
  }
}

export async function pause(cfg: CadenceConfig): Promise<string> {
  return webOrLocal(() => web.pause(), () => local.pause(), cfg);
}

export async function resume(cfg: CadenceConfig): Promise<string> {
  return webOrLocal(() => web.play({}), () => local.play(), cfg);
}

export async function skip(cfg: CadenceConfig): Promise<string> {
  return webOrLocal(() => web.next(), () => local.next(), cfg);
}

export async function previous(cfg: CadenceConfig): Promise<string> {
  return webOrLocal(() => web.previous(), () => local.previous(), cfg);
}

export async function setVolume(cfg: CadenceConfig, percent: number): Promise<void> {
  try {
    await web.volume(percent);
  } catch (e) {
    log("warn", "volume failed", String(e));
  }
}

// Current track + backend, preferring the Web API, then the local player.
export async function nowPlaying(
  cfg: CadenceConfig,
): Promise<{ backend: "web" | "local" | "none"; is_playing: boolean; track?: { uri?: string; title?: string; artist?: string } }> {
  try {
    if (await hasRefreshToken()) {
      const np = await web.nowPlaying();
      if (np) return { backend: "web", is_playing: true, track: np };
    }
  } catch {
    /* fall through */
  }
  if (cfg.enable_local_fallback && (await local.available())) {
    const st = await local.status();
    if (st) return { backend: "local", is_playing: st.playing, track: { title: st.title, artist: st.artist } };
  }
  return { backend: "none", is_playing: false };
}
