import type { CadenceConfig, ModeProfile, State, VibeSlug } from "../shared/types.js";
import { vibeDef, presetCentroid } from "../data/curation.js";
import { applyScoreUpdate } from "./model.js";
import { topArtists, savedTracks } from "../spotify/library.js";
import { log } from "../shared/log.js";

// A fresh per-vibe profile seeded from the bundled curation.
export function newProfile(vibe: VibeSlug, now = Date.now()): ModeProfile {
  const def = vibeDef(vibe);
  const iso = new Date(now).toISOString();
  const genre_scores: ModeProfile["genre_scores"] = {};
  for (const g of def.genres) {
    genre_scores[g] = { score: 0.3, n: 1, last: iso }; // mild prior toward curated genres
  }
  return {
    label: def.label,
    n_events: 0,
    weights_override: null,
    artist_scores: {},
    genre_scores,
    track_scores: {},
    audio_prefs: presetCentroid(vibe),
    tod_histogram: new Array(24).fill(0),
    seed_genres: [...def.genres],
    seed_artists: [],
  };
}

export function ensureProfile(state: State, vibe: VibeSlug): ModeProfile {
  if (!state.modes[vibe]) state.modes[vibe] = newProfile(vibe);
  return state.modes[vibe];
}

// One-time warm-up from the user's Spotify taste -> global priors. Low weight so
// explicit feedback quickly dominates. Mutates `state` in place.
export async function warmFromSpotify(state: State, cfg: CadenceConfig): Promise<number> {
  let touched = 0;
  try {
    const artists = await topArtists("medium_term", 20);
    for (const a of artists) {
      state.global.artist_scores[a.uri] = applyScoreUpdate(
        state.global.artist_scores[a.uri],
        cfg.signal_deltas.sp_top_items,
        cfg,
      );
      for (const g of a.genres ?? []) {
        state.global.genre_scores[g] = applyScoreUpdate(
          state.global.genre_scores[g],
          cfg.signal_deltas.sp_top_items,
          cfg,
        );
      }
      touched++;
    }
    const saved = await savedTracks(50);
    for (const t of saved) {
      state.global.track_scores[t.uri] = applyScoreUpdate(
        state.global.track_scores[t.uri],
        cfg.signal_deltas.sp_saved_tracks,
        cfg,
      );
      touched++;
    }
  } catch (e) {
    log("warn", "warmFromSpotify partial/failed", String(e));
  }
  log("info", "warmed from spotify", { touched });
  return touched;
}
