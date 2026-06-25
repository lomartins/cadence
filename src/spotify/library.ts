import { apiGet } from "./client.js";
import type { TrackCandidate } from "../shared/types.js";
import { cachePath } from "../shared/paths.js";
import { readJson, writeJsonAtomic } from "../shared/atomic.js";
import { log } from "../shared/log.js";

type TimeRange = "short_term" | "medium_term" | "long_term";

interface SpArtist {
  id: string;
  uri: string;
  name: string;
  genres?: string[];
}
interface SpTrack {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
}
interface Paging<T> {
  items: T[];
  next: string | null;
}

function trackToCandidate(t: SpTrack, source: TrackCandidate["source"]): TrackCandidate {
  return {
    uri: t.uri,
    id: t.id,
    title: t.name,
    artist: t.artists[0]?.name,
    artistId: t.artists[0]?.id,
    genres: [],
    source,
  };
}

export async function topArtists(time: TimeRange = "medium_term", limit = 20): Promise<SpArtist[]> {
  try {
    const r = await apiGet<Paging<SpArtist>>("/me/top/artists", { time_range: time, limit });
    return r.items ?? [];
  } catch (e) {
    log("warn", "topArtists failed", String(e));
    return [];
  }
}

export async function topTracks(time: TimeRange = "medium_term", limit = 20): Promise<TrackCandidate[]> {
  try {
    const r = await apiGet<Paging<SpTrack>>("/me/top/tracks", { time_range: time, limit });
    return (r.items ?? []).map((t) => trackToCandidate(t, "top"));
  } catch (e) {
    log("warn", "topTracks failed", String(e));
    return [];
  }
}

export async function recentlyPlayed(limit = 50): Promise<TrackCandidate[]> {
  try {
    const r = await apiGet<Paging<{ track: SpTrack }>>("/me/player/recently-played", { limit });
    return (r.items ?? []).map((i) => trackToCandidate(i.track, "recent"));
  } catch (e) {
    log("warn", "recentlyPlayed failed", String(e));
    return [];
  }
}

export async function savedTracks(limit = 50): Promise<TrackCandidate[]> {
  try {
    const r = await apiGet<Paging<{ track: SpTrack }>>("/me/tracks", { limit });
    return (r.items ?? []).map((i) => trackToCandidate(i.track, "library"));
  } catch (e) {
    log("warn", "savedTracks failed", String(e));
    return [];
  }
}

// Artist genres cache (batch endpoint is dead — fetch single ids and cache).
interface GenreCache {
  [artistId: string]: { genres: string[]; ts: number };
}
const GENRE_TTL = 30 * 24 * 3600 * 1000; // 30 days
let genreMem: GenreCache | null = null;

async function loadGenreCache(): Promise<GenreCache> {
  if (!genreMem) genreMem = await readJson<GenreCache>(cachePath("artist-genres.json"), {});
  return genreMem;
}

export async function artistGenres(artistId: string): Promise<string[]> {
  const cache = await loadGenreCache();
  const hit = cache[artistId];
  if (hit && Date.now() - hit.ts < GENRE_TTL) return hit.genres;
  try {
    const a = await apiGet<SpArtist>(`/artists/${artistId}`);
    const genres = a.genres ?? [];
    cache[artistId] = { genres, ts: Date.now() };
    await writeJsonAtomic(cachePath("artist-genres.json"), cache).catch(() => {});
    return genres;
  } catch (e) {
    log("warn", "artistGenres failed", { artistId, error: String(e) });
    return [];
  }
}

// Enrich a set of candidates with genres, capped to bound API calls.
export async function enrichGenres(
  candidates: TrackCandidate[],
  maxArtists = 20,
): Promise<void> {
  const uniqueArtists = [...new Set(candidates.map((c) => c.artistId).filter(Boolean))].slice(
    0,
    maxArtists,
  ) as string[];
  const map = new Map<string, string[]>();
  for (const id of uniqueArtists) map.set(id, await artistGenres(id));
  for (const c of candidates) {
    if (c.artistId && map.has(c.artistId)) c.genres = map.get(c.artistId)!;
  }
}
