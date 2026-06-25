import type {
  AudioFeatureKey,
  AudioPrefs,
  CadenceConfig,
  ModeProfile,
  RankComponents,
  Score,
  State,
  TrackCandidate,
  WelfordStat,
} from "../shared/types.js";

const DAY_MS = 24 * 3600 * 1000;

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// map a stored raw score in [-1,1] to an affinity in [0,1]
export const nrm = (s: number) => (s + 1) / 2;

function daysSince(iso: string | undefined, now: number): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, (now - t) / DAY_MS);
}

// Normalize a feature value to [0,1] using config.feature_norm for tempo/loudness.
export function normFeature(
  key: AudioFeatureKey,
  value: number,
  cfg: CadenceConfig,
): number {
  if (key === "tempo") {
    const [lo, hi] = cfg.feature_norm.tempo;
    return clamp((value - lo) / (hi - lo), 0, 1);
  }
  if (key === "loudness") {
    const [lo, hi] = cfg.feature_norm.loudness;
    return clamp((value - lo) / (hi - lo), 0, 1);
  }
  return clamp(value, 0, 1);
}

// Cosine-free similarity: inverse-variance-weighted closeness of a track's
// (hand-tagged) features to the mode's intent centroid. Neutral (0.5) when a
// track has no features — common, since live audio-features are unavailable.
export function audioFit(
  features: Partial<Record<AudioFeatureKey, number>> | undefined,
  prefs: AudioPrefs,
  cfg: CadenceConfig,
): number {
  if (!features) return 0.5;
  let num = 0;
  let den = 0;
  for (const key of cfg.audio_feature_keys) {
    const tv = features[key];
    if (tv === undefined) continue;
    const stat = prefs[key];
    const tNorm = normFeature(key, tv, cfg);
    const mNorm = normFeature(key, stat.mean, cfg);
    const varNorm = key === "tempo" || key === "loudness" ? stat.var / 10000 : stat.var;
    const conf = 1 / (1 + varNorm);
    const sim = 1 - Math.abs(tNorm - mNorm);
    num += conf * sim;
    den += conf;
  }
  return den > 0 ? clamp(num / den, 0, 1) : 0.5;
}

function affinity(
  uri: string | undefined,
  modeScores: Record<string, Score>,
  globalScores: Record<string, Score>,
): { a: number; last?: string; n: number } {
  if (!uri) return { a: 0.5, n: 0 };
  const s = modeScores[uri] ?? globalScores[uri];
  if (!s) return { a: 0.5, n: 0 };
  return { a: nrm(s.score), last: s.last, n: s.n };
}

export function componentScores(
  track: TrackCandidate,
  profile: ModeProfile,
  state: State,
  cfg: CadenceConfig,
  now = Date.now(),
): RankComponents {
  const t = affinity(track.uri, profile.track_scores, state.global.track_scores);
  const ar = affinity(track.artistId, profile.artist_scores, state.global.artist_scores);

  let genreSum = 0;
  let genreCount = 0;
  for (const g of track.genres) {
    const s = profile.genre_scores[g] ?? state.global.genre_scores[g];
    if (s) {
      genreSum += nrm(s.score);
      genreCount++;
    }
  }
  const A_genre = genreCount > 0 ? genreSum / genreCount : 0.5;

  const A_audio = audioFit(track.features, profile.audio_prefs, cfg);

  const recencyRef = t.last ?? ar.last;
  const dd = daysSince(recencyRef, now);
  const A_recency = dd === Infinity ? 0.5 : Math.exp(-dd / cfg.decay.half_life_days);

  const hour = new Date(now).getHours();
  const maxTod = Math.max(1, ...profile.tod_histogram);
  const A_tod = profile.tod_histogram[hour] ? profile.tod_histogram[hour] / maxTod : 0;

  const nInMode = profile.track_scores[track.uri]?.n ?? 0;
  const A_novelty = 1 / (1 + nInMode);

  const W = profile.weights_override ?? cfg.ranking_weights;
  const denom = W.w_track + W.w_artist + W.w_genre + W.w_audio + W.w_recency + W.w_tod;
  const base =
    W.w_track * t.a +
    W.w_artist * ar.a +
    W.w_genre * A_genre +
    W.w_audio * A_audio +
    W.w_recency * A_recency +
    W.w_tod * A_tod;
  const exploit = denom > 0 ? base / denom : 0.5;
  const final = (1 - W.w_novelty) * exploit + W.w_novelty * A_novelty;

  return {
    A_track: t.a,
    A_artist: ar.a,
    A_genre,
    A_audio,
    A_recency,
    A_tod,
    A_novelty,
    final: clamp(final, 0, 1),
  };
}

// Apply a signed delta to a stored score: time-decay toward 0, then a
// confidence-weighted update (more evidence -> smaller steps).
export function applyScoreUpdate(
  prev: Score | undefined,
  delta: number,
  cfg: CadenceConfig,
  now = Date.now(),
): Score {
  const s = prev ?? { score: 0, n: 0, last: new Date(now).toISOString() };
  const dd = daysSince(s.last, now);
  const decayed = dd === Infinity ? s.score : s.score * Math.pow(0.5, dd / cfg.decay.half_life_days);
  const lr = Math.max(0.05, 1 / (s.n + 1));
  const score = clamp(decayed + lr * delta * (1 + Math.abs(delta)), -1, 1);
  return { ...s, score, n: s.n + 1, last: new Date(now).toISOString() };
}

// Welford running mean/var update (reconstruct M2 from stored var*n).
export function welfordUpdate(stat: WelfordStat, x: number): WelfordStat {
  const n = stat.n + 1;
  const m2Old = stat.var * stat.n;
  const delta = x - stat.mean;
  const mean = stat.mean + delta / n;
  const m2 = m2Old + delta * (x - mean);
  return { mean, var: n > 0 ? m2 / n : 0, n };
}
