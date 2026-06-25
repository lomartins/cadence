import { describe, it, expect } from "vitest";
import {
  nrm,
  clamp,
  applyScoreUpdate,
  welfordUpdate,
  componentScores,
  audioFit,
} from "../src/learn/model.js";
import { applyEventToState, freshState } from "../src/learn/store.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { presetCentroid } from "../src/data/curation.js";
import type { FeedbackEvent, TrackCandidate } from "../src/shared/types.js";

const cfg = DEFAULT_CONFIG;

describe("model math", () => {
  it("nrm maps [-1,1] -> [0,1]", () => {
    expect(nrm(-1)).toBe(0);
    expect(nrm(0)).toBe(0.5);
    expect(nrm(1)).toBe(1);
  });

  it("clamp bounds values", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it("positive feedback raises score, stays in [-1,1]", () => {
    let s = applyScoreUpdate(undefined, cfg.signal_deltas.love, cfg);
    expect(s.score).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) s = applyScoreUpdate(s, cfg.signal_deltas.love, cfg);
    expect(s.score).toBeLessThanOrEqual(1);
    expect(s.score).toBeGreaterThanOrEqual(-1);
  });

  it("negative feedback lowers score", () => {
    const s = applyScoreUpdate({ score: 0.5, n: 1, last: new Date().toISOString() }, cfg.signal_deltas.dislike, cfg);
    expect(s.score).toBeLessThan(0.5);
  });

  it("welford tracks a running mean", () => {
    let stat = { mean: 0, var: 0, n: 0 };
    for (const x of [0.2, 0.4, 0.6]) stat = welfordUpdate(stat, x);
    expect(stat.n).toBe(3);
    expect(stat.mean).toBeCloseTo(0.4, 5);
  });

  it("audioFit is neutral without features and bounded with them", () => {
    const prefs = presetCentroid("deep-focus");
    expect(audioFit(undefined, prefs, cfg)).toBe(0.5);
    const fit = audioFit({ energy: 0.25, tempo: 90 }, prefs, cfg);
    expect(fit).toBeGreaterThanOrEqual(0);
    expect(fit).toBeLessThanOrEqual(1);
  });

  it("componentScores.final is always in [0,1]", () => {
    const state = freshState();
    const profile = (state.modes["deep-focus"] = {
      label: "Deep Focus",
      n_events: 0,
      weights_override: null,
      artist_scores: {},
      genre_scores: {},
      track_scores: {},
      audio_prefs: presetCentroid("deep-focus"),
      tod_histogram: new Array(24).fill(0),
      seed_genres: [],
      seed_artists: [],
    });
    const track: TrackCandidate = {
      uri: "spotify:track:abc",
      id: "abc",
      artistId: "art1",
      genres: ["ambient"],
      source: "search",
    };
    const c = componentScores(track, profile, state, cfg);
    expect(c.final).toBeGreaterThanOrEqual(0);
    expect(c.final).toBeLessThanOrEqual(1);
  });
});

describe("feedback fold determinism", () => {
  const events: FeedbackEvent[] = [
    { ts: "2026-06-01T10:00:00Z", mode: "deep-focus", event: "love", track: "spotify:track:a", artist: "spotify:artist:x", genres: ["ambient"], source: "user", hour: 10 },
    { ts: "2026-06-01T10:05:00Z", mode: "deep-focus", event: "skip_early", track: "spotify:track:b", played_fraction: 0.05, source: "player", hour: 10 },
    { ts: "2026-06-02T11:00:00Z", mode: "steady-flow", event: "like", track: "spotify:track:c", genres: ["chillhop"], source: "user", hour: 11 },
    { ts: "2026-06-02T11:10:00Z", mode: "deep-focus", event: "ban", track: "spotify:track:b", source: "user", hour: 11 },
  ];

  function fold() {
    const s = freshState(Date.parse("2026-06-01T00:00:00Z"));
    for (const ev of events) applyEventToState(s, ev, cfg);
    return s;
  }

  it("is deterministic (same log -> same state)", () => {
    expect(JSON.stringify(fold())).toEqual(JSON.stringify(fold()));
  });

  it("applies bans and loved-track scores", () => {
    const s = fold();
    expect(s.global.banned.tracks).toContain("spotify:track:b");
    expect(s.modes["deep-focus"].track_scores["spotify:track:a"].score).toBeGreaterThan(0);
    expect(s.modes["deep-focus"].n_events).toBeGreaterThan(0);
  });
});
