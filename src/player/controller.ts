import type {
  Backend,
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
import { PremiumRequiredError, NoActiveDeviceError, RateLimitedError } from "../spotify/client.js";
import { NeedsAuthError, hasRefreshToken } from "../spotify/tokens.js";
import { rankCandidates, buildQueue } from "../learn/ranker.js";
import { ensureProfile } from "../learn/coldstart.js";
import { vibeDef } from "../data/curation.js";
import { log } from "../shared/log.js";

let lastQueue: TrackCandidate[] = [];

export function getLastQueueHead(): TrackCandidate | undefined {
  return lastQueue[0];
}

// Remember which vibe + candidate each recently played/queued track belongs to,
// so feedback is attributed to the track that is ACTUALLY playing — not to a vibe
// we just switched to whose tracks haven't started yet (auto-switch handoff).
interface TrackMeta {
  vibe: VibeSlug;
  candidate: TrackCandidate;
}
const trackMeta = new Map<string, TrackMeta>();
const META_CAP = 300;

function recordMeta(queue: TrackCandidate[], vibe: VibeSlug): void {
  for (const c of queue) trackMeta.set(c.uri, { vibe, candidate: c });
  // evict oldest entries past the cap (Map preserves insertion order)
  while (trackMeta.size > META_CAP) {
    const oldest = trackMeta.keys().next().value;
    if (oldest === undefined) break;
    trackMeta.delete(oldest);
  }
}

export function getTrackMeta(uri?: string): TrackMeta | undefined {
  return uri ? trackMeta.get(uri) : undefined;
}

// Discover + rank a fresh queue for a vibe/intensity using only surviving APIs.
async function discover(
  cfg: CadenceConfig,
  state: State,
  vibe: VibeSlug,
  intensity: Intensity,
): Promise<TrackCandidate[]> {
  const pool = await poolForVibe(vibe, intensity, cfg.market, 1);

  // Personalize ONLY for vibes that allow lyrics (momentum/decompress). For
  // focus/deep-work vibes we keep it purely curated + instrumental, so the
  // user's own (often vocal) top tracks never leak into a focus session.
  if (vibeDef(vibe).audio.lyrics) {
    try {
      const tops = await topTracks("medium_term", 10, cfg.market);
      for (const t of tops) if (!pool.some((p) => p.id === t.id)) pool.push(t);
    } catch {
      /* optional */
    }
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
    result.message = "Not connected to Spotify. Run /cadence:connect.";
    return result;
  }

  try {
    const queue = await discover(cfg, state, vibe, intensity);
    lastQueue = queue;
    recordMeta(queue, vibe);
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
      result.message = "Spotify session expired. Run /cadence:connect.";
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
    if (e instanceof RateLimitedError) {
      result.message = `Spotify is rate-limiting requests — try again in ~${e.retryAfter}s.`;
      return result;
    }
    log("error", "playVibe failed", String(e));
    if (cfg.enable_local_fallback) return localFallback(result, "Web playback failed.");
    result.message = `Playback failed: ${String(e)}`;
    return result;
  }
}

// Add the next vibe's tracks to the Spotify "Up Next" queue WITHOUT interrupting
// the current track (used by auto-switch). The current song finishes, then these
// tracks play; afterwards Spotify resumes the previous context (this is a
// temporary "play next" detour, not a hard switch — by design). Returns how many
// tracks actually landed, or null when queueing isn't possible (non-web backend,
// no Premium, no device, nothing to queue).
export async function queueVibe(
  cfg: CadenceConfig,
  state: State,
  vibe: VibeSlug,
  intensity: Intensity,
  opts: { backend?: Backend; currentUri?: string } = {},
  count = 8,
): Promise<{ queued: number; first?: TrackCandidate } | null> {
  // queueing only works over the Web API; playerctl/MPRIS can't insert a queue.
  // Trust the caller's backend if provided to avoid a second GET /me/player.
  const backend = opts.backend ?? (await nowPlaying(cfg).catch(() => null))?.backend;
  if (backend !== "web") return null;

  let queue: TrackCandidate[];
  try {
    queue = await discover(cfg, state, vibe, intensity);
  } catch (e) {
    log("warn", "queueVibe discover failed", String(e));
    return null;
  }

  // don't re-queue the song that's already playing
  const candidates = opts.currentUri ? queue.filter((t) => t.uri !== opts.currentUri) : queue;
  const toQueue = candidates.slice(0, count);
  if (toQueue.length === 0) return null;

  // queue one at a time; stop at the first failure (tracks already added can't
  // be un-added) and report what actually landed.
  let queued = 0;
  for (const t of toQueue) {
    try {
      await web.queueAdd(t.uri);
      queued++;
    } catch (e) {
      log("warn", "queueAdd failed mid-loop, stopping", String(e));
      break;
    }
  }
  if (queued === 0) return null;

  recordMeta(candidates, vibe);
  lastQueue = candidates;
  log("info", "queued vibe to play next", { vibe, intensity, queued });
  return { queued, first: toQueue[0] };
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
