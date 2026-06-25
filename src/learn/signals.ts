import type { CadenceConfig, FeedbackEventName } from "../shared/types.js";

// Classify how a track playback ended given the fraction played.
export function classifyPlaybackEnd(
  fraction: number,
  cfg: CadenceConfig,
): "completed" | "skip_early" | "skip_late" {
  if (fraction >= cfg.thresholds.completion) return "completed";
  if (fraction < cfg.thresholds.skip) return "skip_early";
  return "skip_late";
}

// Map an event (with optional played_fraction) to a signed score delta.
// Early skips hurt more than near-threshold ones.
export function deltaFor(
  event: FeedbackEventName,
  cfg: CadenceConfig,
  playedFraction?: number,
): number {
  const d = cfg.signal_deltas;
  switch (event) {
    case "love":
      return d.love;
    case "like":
      return d.like;
    case "dislike":
      return d.dislike;
    case "more_like_this":
      return d.more_like_this;
    case "completed":
      return d.completed;
    case "replay":
      return d.replay;
    case "skip_late":
      return d.skip_late;
    case "skip_early": {
      const frac = playedFraction ?? 0;
      const scale = 1 - frac / cfg.thresholds.skip; // 1 at instant skip, ~0 near threshold
      return d.skip_base * Math.max(0, Math.min(1, scale));
    }
    case "auto_switch_accept":
      return d.auto_switch_accept;
    case "auto_switch_reject":
      return d.auto_switch_reject;
    case "sp_recently_played":
      return d.sp_recently_played;
    case "sp_top_items":
      return d.sp_top_items;
    case "sp_saved_tracks":
      return d.sp_saved_tracks;
    case "ban":
      return 0; // handled separately as a hard exclude
    default:
      return 0;
  }
}

// Positive signals also nudge the audio-intent centroid; negatives only push
// track/artist/genre scores down.
const POSITIVE: ReadonlySet<FeedbackEventName> = new Set([
  "love",
  "like",
  "more_like_this",
  "completed",
  "replay",
]);

export function isPositive(event: FeedbackEventName): boolean {
  return POSITIVE.has(event);
}
