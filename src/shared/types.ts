// Cadence — shared type contract. Every module depends on these shapes.

export type WorkMode =
  | "deep-focus coding"
  | "debugging"
  | "writing/docs"
  | "planning/architecture"
  | "code review / reading"
  | "learning/research"
  | "repetitive/mechanical"
  | "break"
  | "crunch";

export type VibeSlug =
  | "deep-focus"
  | "steady-flow"
  | "wordless-write"
  | "open-think"
  | "calm-read"
  | "alert-study"
  | "momentum"
  | "decompress"
  | "drive";

export type Intensity = 0 | 1 | 2 | 3 | 4;

export const VIBE_SLUGS: VibeSlug[] = [
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

export const AUDIO_FEATURE_KEYS = [
  "energy",
  "valence",
  "danceability",
  "acousticness",
  "instrumentalness",
  "tempo",
  "loudness",
] as const;
export type AudioFeatureKey = (typeof AUDIO_FEATURE_KEYS)[number];

// ---- Config (config.json, user-overridable) ----
export interface RankingWeights {
  w_track: number;
  w_artist: number;
  w_genre: number;
  w_audio: number;
  w_recency: number;
  w_tod: number;
  w_novelty: number;
}

export interface SignalDeltas {
  love: number;
  like: number;
  dislike: number;
  more_like_this: number;
  completed: number;
  replay: number;
  skip_base: number;
  skip_late: number;
  auto_switch_accept: number;
  auto_switch_reject: number;
  sp_recently_played: number;
  sp_top_items: number;
  sp_saved_tracks: number;
}

export interface CadenceConfig {
  schema_version: 2;
  market: string;
  default_vibe: VibeSlug;
  auto_switch: boolean;
  enable_local_fallback: boolean;
  auth_port: number; // loopback OAuth callback port; register http://127.0.0.1:<port>/callback
  debug: boolean;
  ranking_weights: RankingWeights;
  signal_deltas: SignalDeltas;
  thresholds: { completion: number; skip: number };
  decay: { half_life_days: number };
  explore: {
    epsilon: number;
    epsilon_min: number;
    epsilon_cold: number;
    warm_n: number;
  };
  audio_feature_keys: AudioFeatureKey[];
  feature_norm: { tempo: [number, number]; loudness: [number, number] };
  selection: { max_per_artist: number; queue_size: number };
  autoswitch: { debounce_seconds: number; confidence: number };
  privacy: { store_track_titles: boolean; log_retention_days: number };
}

// ---- Learned state (state.json) ----
export interface Score {
  score: number; // [-1,1]
  n: number; // evidence count
  last: string; // ISO timestamp
  plays?: number;
  completes?: number;
  skips?: number;
}

export interface WelfordStat {
  mean: number;
  var: number;
  n: number;
}

export type AudioPrefs = Record<AudioFeatureKey, WelfordStat>;

export interface ModeProfile {
  label: string;
  n_events: number;
  weights_override: RankingWeights | null;
  artist_scores: Record<string, Score>;
  genre_scores: Record<string, Score>;
  track_scores: Record<string, Score>;
  audio_prefs: AudioPrefs; // "intent" centroid, seeded from presets
  tod_histogram: number[]; // length 24
  seed_genres: string[];
  seed_artists: string[];
}

export interface State {
  schema_version: 2;
  user_id: string;
  created_at: string;
  updated_at: string;
  global: {
    banned: { tracks: string[]; artists: string[]; genres: string[] };
    artist_scores: Record<string, Score>;
    genre_scores: Record<string, Score>;
    track_scores: Record<string, Score>;
  };
  modes: Record<string, ModeProfile>; // keyed by VibeSlug
}

// ---- Feedback log (feedback.jsonl) ----
export type FeedbackEventName =
  | "love"
  | "like"
  | "dislike"
  | "ban"
  | "more_like_this"
  | "completed"
  | "skip_early"
  | "skip_late"
  | "replay"
  | "auto_switch_accept"
  | "auto_switch_reject"
  | "sp_recently_played"
  | "sp_top_items"
  | "sp_saved_tracks";

export interface FeedbackEvent {
  ts: string;
  mode: VibeSlug;
  event: FeedbackEventName;
  track?: string;
  artist?: string;
  genres?: string[];
  title?: string;
  played_fraction?: number;
  features?: Partial<Record<AudioFeatureKey, number>>;
  source: "user" | "player" | "spotify" | "explore";
  hour: number; // 0-23
}

// ---- Curation table (presets.json) ----
export interface IntensityScaleEntry {
  label: string;
  bpm: [number, number];
  energy: string;
}
export type IntensityScale = Record<string, IntensityScaleEntry>;

export interface VibeAudioIntent {
  bpm: [number, number];
  energy: string;
  valence: string;
  instrumentalness: string;
  lyrics: boolean;
  acousticness: string;
}

export interface VibeDef {
  label: string;
  workModes: WorkMode[];
  defaultIntensity: Intensity;
  audio: VibeAudioIntent;
  genres: string[];
  searchQueries: string[];
  playlists: string[];
  rationale: string;
}

export interface CurationTable {
  version: string;
  intensityScale: IntensityScale;
  vibes: Record<VibeSlug, VibeDef>;
  workModeToVibe: Record<string, VibeSlug>;
}

// ---- Runtime / playback ----
export interface TrackCandidate {
  uri: string;
  id: string;
  title?: string;
  artist?: string;
  artistId?: string;
  genres: string[];
  features?: Partial<Record<AudioFeatureKey, number>>;
  source: "search" | "library" | "top" | "recent" | "playlist" | "explore";
}

export interface RankComponents {
  A_track: number;
  A_artist: number;
  A_genre: number;
  A_audio: number;
  A_recency: number;
  A_tod: number;
  A_novelty: number;
  final: number;
}

export type Backend = "web" | "local" | "none";

export interface PlaybackState {
  backend: Backend;
  is_playing: boolean;
  vibe: VibeSlug;
  intensity: Intensity;
  mode: WorkMode;
  auto_switch: boolean;
  track?: { uri?: string; title?: string; artist?: string };
  needs_premium?: boolean;
  needs_auth?: boolean;
  no_device?: boolean;
  message?: string;
}

export interface Device {
  id: string;
  is_active: boolean;
  name: string;
  type: string;
}

// ---- IPC (hooks <-> brain) ----
export interface HookEvent {
  kind: "prompt" | "tool" | "session-end";
  session_id: string;
  cwd: string;
  ts: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
}

export type IpcMessage =
  | { type: "event"; payload: HookEvent }
  | { type: "now-playing"; payload: { session_id: string } }
  | { type: "switch"; payload: { vibe: VibeSlug } }
  | { type: "ping" };

export interface IpcResponse {
  ok: boolean;
  banner?: string;
  error?: string;
}

// ---- Detection ----
export interface SessionState {
  session_id: string;
  auto_switch: boolean;
  current_mode: WorkMode;
  current_vibe: VibeSlug;
  intensity: Intensity;
  last_switch_ts: number;
}

export interface ClassifyResult {
  workMode: WorkMode;
  confidence: number;
}
