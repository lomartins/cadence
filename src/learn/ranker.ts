import type {
  CadenceConfig,
  ModeProfile,
  RankComponents,
  State,
  TrackCandidate,
} from "../shared/types.js";
import { componentScores } from "./model.js";

export interface Ranked {
  candidate: TrackCandidate;
  comp: RankComponents;
}

function isBanned(c: TrackCandidate, state: State): boolean {
  const b = state.global.banned;
  if (b.tracks.includes(c.uri)) return true;
  if (c.artistId && (b.artists.includes(c.artistId) || b.artists.includes(`spotify:artist:${c.artistId}`)))
    return true;
  if (c.genres.some((g) => b.genres.includes(g))) return true;
  return false;
}

// Score and sort candidates (descending). Banned candidates are hard-filtered.
export function rankCandidates(
  candidates: TrackCandidate[],
  profile: ModeProfile,
  state: State,
  cfg: CadenceConfig,
  now = Date.now(),
): Ranked[] {
  return candidates
    .filter((c) => !isBanned(c, state))
    .map((candidate) => ({ candidate, comp: componentScores(candidate, profile, state, cfg, now) }))
    .sort((a, b) => b.comp.final - a.comp.final);
}

function epsilonFor(profile: ModeProfile, cfg: CadenceConfig): number {
  const { epsilon, epsilon_min, epsilon_cold, warm_n } = cfg.explore;
  if (profile.n_events < warm_n) return epsilon_cold;
  return Math.max(epsilon_min, epsilon * (warm_n / profile.n_events));
}

// Build a play queue with epsilon-greedy explore/exploit and a per-artist
// diversity cap (no more than max_per_artist consecutive from one artist).
export function buildQueue(
  ranked: Ranked[],
  profile: ModeProfile,
  cfg: CadenceConfig,
  rng: () => number = Math.random,
): TrackCandidate[] {
  const size = Math.min(cfg.selection.queue_size, ranked.length);
  const maxArtist = cfg.selection.max_per_artist;
  const epsilon = epsilonFor(profile, cfg);
  const topK = Math.max(1, Math.floor(ranked.length * 0.3));
  const pool = [...ranked];
  const queue: TrackCandidate[] = [];

  const violatesDiversity = (artistId?: string): boolean => {
    if (!artistId || maxArtist <= 0) return false;
    const tail = queue.slice(-maxArtist);
    return tail.length === maxArtist && tail.every((t) => t.artistId === artistId);
  };

  while (queue.length < size && pool.length > 0) {
    let pickIdx = 0;
    // decide explore vs exploit up front so the source label is accurate
    const explored = rng() < epsilon && pool.length > topK;
    if (explored) {
      // explore: weighted-random over the tail, biased by novelty
      const tail = pool.slice(topK);
      const weights = tail.map((r) => r.comp.A_novelty + 0.01);
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = rng() * total;
      let idx = 0;
      for (; idx < weights.length; idx++) {
        roll -= weights[idx];
        if (roll <= 0) break;
      }
      pickIdx = topK + Math.min(idx, tail.length - 1);
    }

    // skip forward if the pick would violate the diversity cap
    let chosen = pickIdx;
    while (chosen < pool.length && violatesDiversity(pool[chosen].candidate.artistId)) chosen++;
    if (chosen >= pool.length) chosen = pickIdx; // give up, accept original

    const [r] = pool.splice(chosen, 1);
    queue.push(explored ? { ...r.candidate, source: "explore" } : r.candidate);
  }

  return queue;
}
