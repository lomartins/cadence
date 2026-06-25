import { apiGet } from "./client.js";
import { applyIntensity } from "../data/curation.js";
import type { Intensity, TrackCandidate, VibeSlug } from "../shared/types.js";
import { log } from "../shared/log.js";

interface SpArtistRef {
  id: string;
  name: string;
}
interface SpTrack {
  id: string;
  uri: string;
  name: string;
  is_playable?: boolean;
  artists: SpArtistRef[];
}
interface SearchResp {
  tracks?: { items: SpTrack[]; next: string | null };
  playlists?: { items: Array<{ id: string; name: string; owner: { id: string } }> };
}

function toCandidate(t: SpTrack, source: TrackCandidate["source"]): TrackCandidate {
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

// Build the intensity-aware query set for a vibe.
export function buildQueries(vibe: VibeSlug, intensity: Intensity): string[] {
  return applyIntensity(vibe, intensity);
}

// Run one search query. Dev-mode caps limit at 10 — paginate via offset.
export async function searchTracks(
  q: string,
  market: string,
  opts: { limit?: number; pages?: number } = {},
): Promise<TrackCandidate[]> {
  const limit = Math.min(opts.limit ?? 10, 10);
  const pages = opts.pages ?? 1;
  const out: TrackCandidate[] = [];
  for (let page = 0; page < pages; page++) {
    try {
      const resp = await apiGet<SearchResp>("/search", {
        q,
        type: "track",
        market,
        limit,
        offset: page * limit,
      });
      const items = resp.tracks?.items ?? [];
      for (const t of items) {
        if (t.is_playable === false) continue;
        out.push(toCandidate(t, "search"));
      }
      if (!resp.tracks?.next) break;
    } catch (e) {
      log("warn", "search query failed", { q, error: String(e) });
      break;
    }
  }
  return out;
}

// Pool every vibe query, dedupe by track id.
export async function poolForVibe(
  vibe: VibeSlug,
  intensity: Intensity,
  market: string,
  perQueryPages = 1,
): Promise<TrackCandidate[]> {
  const queries = buildQueries(vibe, intensity);
  const seen = new Set<string>();
  const pool: TrackCandidate[] = [];
  for (const q of queries) {
    const tracks = await searchTracks(q, market, { pages: perQueryPages });
    for (const t of tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      pool.push(t);
    }
  }
  return pool;
}

const playlistCache = new Map<string, string | null>();

// Best-effort: resolve a curated playlist name to an id via search. New apps
// often cannot fetch the *items* of editorial playlists, so this is advisory.
export async function resolvePlaylistByName(name: string, market: string): Promise<string | null> {
  if (playlistCache.has(name)) return playlistCache.get(name) ?? null;
  try {
    const resp = await apiGet<SearchResp>("/search", {
      q: name,
      type: "playlist",
      market,
      limit: 5,
    });
    const items = resp.playlists?.items ?? [];
    const official = items.find((p) => p.owner?.id === "spotify");
    const id = (official ?? items[0])?.id ?? null;
    playlistCache.set(name, id);
    return id;
  } catch {
    playlistCache.set(name, null);
    return null;
  }
}
