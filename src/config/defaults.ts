import type { CadenceConfig, VibeSlug } from "../shared/types.js";

export const DEFAULT_CONFIG: CadenceConfig = {
  schema_version: 2,
  market: "US",
  default_vibe: "deep-focus",
  auto_switch: true,
  enable_local_fallback: true,
  debug: false,
  ranking_weights: {
    w_track: 0.3,
    w_artist: 0.2,
    w_genre: 0.2,
    w_audio: 0.2,
    w_recency: 0.05,
    w_tod: 0.05,
    w_novelty: 0.1,
  },
  signal_deltas: {
    love: 0.5,
    like: 0.25,
    dislike: -0.3,
    more_like_this: 0.2,
    completed: 0.1,
    replay: 0.08,
    skip_base: -0.2,
    skip_late: -0.02,
    auto_switch_accept: 0.1,
    auto_switch_reject: -0.15,
    sp_recently_played: 0.04,
    sp_top_items: 0.06,
    sp_saved_tracks: 0.05,
  },
  thresholds: { completion: 0.85, skip: 0.3 },
  decay: { half_life_days: 45 },
  explore: { epsilon: 0.15, epsilon_min: 0.05, epsilon_cold: 0.4, warm_n: 60 },
  audio_feature_keys: [
    "energy",
    "valence",
    "danceability",
    "acousticness",
    "instrumentalness",
    "tempo",
    "loudness",
  ],
  feature_norm: { tempo: [60, 200], loudness: [-60, 0] },
  selection: { max_per_artist: 2, queue_size: 25 },
  autoswitch: { debounce_seconds: 90, confidence: 0.6 },
  privacy: { store_track_titles: false, log_retention_days: 365 },
};

const VALID_VIBES: VibeSlug[] = [
  "deep-focus",
  "steady-flow",
  "wordless-write",
  "open-think",
  "calm-read",
  "alert-study",
  "momentum",
  "decompress",
  "drive",
];

export function coerceVibe(v: string | undefined, fallback: VibeSlug): VibeSlug {
  if (v && (VALID_VIBES as string[]).includes(v)) return v as VibeSlug;
  return fallback;
}
