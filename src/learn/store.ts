import { readFile } from "node:fs/promises";
import type {
  CadenceConfig,
  FeedbackEvent,
  Score,
  State,
  VibeSlug,
} from "../shared/types.js";
import { statePath, feedbackPath, ensureDirs } from "../shared/paths.js";
import { readJson, writeJsonAtomic, appendLine, withLock } from "../shared/atomic.js";
import { applyScoreUpdate, welfordUpdate } from "./model.js";
import { deltaFor, isPositive } from "./signals.js";
import { ensureProfile } from "./coldstart.js";
import { log } from "../shared/log.js";

export function freshState(now = Date.now()): State {
  const iso = new Date(now).toISOString();
  return {
    schema_version: 2,
    user_id: "local",
    created_at: iso,
    updated_at: iso,
    global: {
      banned: { tracks: [], artists: [], genres: [] },
      artist_scores: {},
      genre_scores: {},
      track_scores: {},
    },
    modes: {},
  };
}

export async function loadState(): Promise<State> {
  ensureDirs();
  const s = await readJson<State | null>(statePath(), null);
  if (!s || s.schema_version !== 2) return freshState();
  return s;
}

export async function saveState(state: State): Promise<void> {
  state.updated_at = new Date().toISOString();
  await withLock("state", () => writeJsonAtomic(statePath(), state));
}

function bumpScore(
  map: Record<string, Score>,
  key: string | undefined,
  delta: number,
  cfg: CadenceConfig,
  now: number,
): void {
  if (!key || delta === 0) return;
  map[key] = applyScoreUpdate(map[key], delta, cfg, now);
}

const PLAY_EVENTS = new Set(["completed", "skip_early", "skip_late", "replay", "love", "like"]);

// The fold: apply one event to the state. Pure-ish (mutates `state`), uses the
// event's own timestamp as "now" so rebuild() is deterministic.
export function applyEventToState(state: State, ev: FeedbackEvent, cfg: CadenceConfig): void {
  const now = Date.parse(ev.ts) || Date.now();
  const profile = ensureProfile(state, ev.mode);

  if (ev.event === "ban") {
    if (ev.track && !state.global.banned.tracks.includes(ev.track))
      state.global.banned.tracks.push(ev.track);
    if (ev.artist && !state.global.banned.artists.includes(ev.artist))
      state.global.banned.artists.push(ev.artist);
    state.updated_at = new Date(now).toISOString();
    return;
  }

  const delta = deltaFor(ev.event, cfg, ev.played_fraction);

  if (delta !== 0) {
    bumpScore(profile.track_scores, ev.track, delta, cfg, now);
    bumpScore(state.global.track_scores, ev.track, delta, cfg, now);
    bumpScore(profile.artist_scores, ev.artist, delta, cfg, now);
    bumpScore(state.global.artist_scores, ev.artist, delta, cfg, now);
    for (const g of ev.genres ?? []) {
      bumpScore(profile.genre_scores, g, delta, cfg, now);
      bumpScore(state.global.genre_scores, g, delta, cfg, now);
    }
  }

  // track play counters
  if (ev.track && PLAY_EVENTS.has(ev.event)) {
    const ts = profile.track_scores[ev.track];
    if (ts) {
      ts.plays = (ts.plays ?? 0) + 1;
      if (ev.event === "completed") ts.completes = (ts.completes ?? 0) + 1;
      if (ev.event === "skip_early" || ev.event === "skip_late") ts.skips = (ts.skips ?? 0) + 1;
    }
  }

  // audio-intent centroid: positive signals only
  if (isPositive(ev.event) && ev.features) {
    for (const [k, v] of Object.entries(ev.features)) {
      const key = k as keyof typeof profile.audio_prefs;
      if (profile.audio_prefs[key] && typeof v === "number") {
        profile.audio_prefs[key] = welfordUpdate(profile.audio_prefs[key], v);
      }
    }
  }

  // time-of-day histogram on real listening events
  if (PLAY_EVENTS.has(ev.event)) {
    const h = ev.hour >= 0 && ev.hour < 24 ? ev.hour : new Date(now).getHours();
    profile.tod_histogram[h] = (profile.tod_histogram[h] ?? 0) + 1;
  }

  profile.n_events += 1;
  state.updated_at = new Date(now).toISOString();
}

// Durable-first: append to the log, then fold into state and persist.
export async function appendFeedback(
  state: State,
  ev: FeedbackEvent,
  cfg: CadenceConfig,
): Promise<void> {
  ensureDirs();
  await appendLine(feedbackPath(), ev);
  applyEventToState(state, ev, cfg);
  await saveState(state);
}

// Deterministically rebuild state.json from the append-only feedback log.
export async function rebuild(cfg: CadenceConfig, now = Date.now()): Promise<State> {
  const state = freshState();
  let raw = "";
  try {
    raw = await readFile(feedbackPath(), "utf8");
  } catch {
    return state;
  }
  const cutoff = now - cfg.privacy.log_retention_days * 24 * 3600 * 1000;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as FeedbackEvent;
      if ((Date.parse(ev.ts) || 0) < cutoff) continue;
      applyEventToState(state, ev, cfg);
    } catch {
      /* skip malformed line */
    }
  }
  await saveState(state);
  log("info", "state rebuilt from feedback log");
  return state;
}

export interface ExportBundle {
  exported_at: string;
  state: State;
  feedback?: FeedbackEvent[];
}

export async function exportBundle(state: State, includeFeedback = true): Promise<ExportBundle> {
  const bundle: ExportBundle = { exported_at: new Date().toISOString(), state };
  if (includeFeedback) {
    try {
      const raw = await readFile(feedbackPath(), "utf8");
      bundle.feedback = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as FeedbackEvent);
    } catch {
      /* none */
    }
  }
  return bundle;
}

export async function importBundle(bundle: ExportBundle): Promise<State> {
  ensureDirs();
  await saveState(bundle.state);
  if (bundle.feedback?.length) {
    const lines = bundle.feedback.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await (await import("node:fs/promises")).writeFile(feedbackPath(), lines, "utf8");
  }
  return bundle.state;
}

export async function reset(target: "all" | VibeSlug): Promise<State> {
  if (target === "all") {
    const fresh = freshState();
    await saveState(fresh);
    await (await import("node:fs/promises")).writeFile(feedbackPath(), "", "utf8").catch(() => {});
    return fresh;
  }
  const state = await loadState();
  delete state.modes[target];
  await saveState(state);
  return state;
}

// Purge a track or artist from every profile, ban list, and the feedback log.
export async function forget(state: State, uri: string, cfg: CadenceConfig): Promise<State> {
  const scrub = (m: Record<string, Score>) => {
    delete m[uri];
  };
  scrub(state.global.track_scores);
  scrub(state.global.artist_scores);
  scrub(state.global.genre_scores);
  for (const mode of Object.values(state.modes)) {
    scrub(mode.track_scores);
    scrub(mode.artist_scores);
    scrub(mode.genre_scores);
  }
  state.global.banned.tracks = state.global.banned.tracks.filter((t) => t !== uri);
  state.global.banned.artists = state.global.banned.artists.filter((a) => a !== uri);

  // rewrite the feedback log without this entity
  try {
    const raw = await readFile(feedbackPath(), "utf8");
    const kept = raw
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => {
        try {
          const ev = JSON.parse(l) as FeedbackEvent;
          return ev.track !== uri && ev.artist !== uri;
        } catch {
          return false;
        }
      });
    await (await import("node:fs/promises")).writeFile(
      feedbackPath(),
      kept.join("\n") + (kept.length ? "\n" : ""),
      "utf8",
    );
  } catch {
    /* no log */
  }
  await saveState(state);
  return state;
}
