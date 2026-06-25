import { describe, it, expect } from "vitest";
import {
  applyIntensity,
  vibeForWorkMode,
  loadCuration,
  looksVocal,
  vibeAllowsLyrics,
} from "../src/data/curation.js";
import { classify } from "../src/detect/classifier.js";
import { buildQueue, rankCandidates } from "../src/learn/ranker.js";
import { newProfile } from "../src/learn/coldstart.js";
import { freshState } from "../src/learn/store.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { TrackCandidate } from "../src/shared/types.js";

describe("curation / intensity", () => {
  it("has all 9 vibes mapped from work modes", () => {
    const c = loadCuration();
    expect(Object.keys(c.vibes)).toHaveLength(9);
    expect(vibeForWorkMode("debugging")).toBe("steady-flow");
    expect(vibeForWorkMode("crunch")).toBe("drive");
  });

  it("intensity 0 strips beat-driven seeds", () => {
    const qs = applyIntensity("deep-focus", 0);
    expect(qs.some((q) => /lo-?fi|beats/i.test(q))).toBe(false);
  });

  it("intensity >=3 adds a driving flavor", () => {
    const qs = applyIntensity("momentum", 4);
    expect(qs.some((q) => /epic|energetic|drum and bass|driving/i.test(q))).toBe(true);
  });

  it("forces 'instrumental' on every query for lyric-free vibes", () => {
    for (const v of ["deep-focus", "wordless-write", "calm-read", "drive"] as const) {
      const qs = applyIntensity(v, 2);
      expect(qs.every((q) => /instrumental/i.test(q))).toBe(true);
    }
  });

  it("does NOT force instrumental on lyric-friendly vibes", () => {
    expect(vibeAllowsLyrics("momentum")).toBe(true);
    expect(vibeAllowsLyrics("decompress")).toBe(true);
    expect(vibeAllowsLyrics("deep-focus")).toBe(false);
  });

  it("flags obviously-vocal titles", () => {
    expect(looksVocal("Samba Enredo 2024 (Ao Vivo)")).toBe(true);
    expect(looksVocal("Some Song feat. MC X")).toBe(true);
    expect(looksVocal("Rainy Lofi Piano Study")).toBe(false);
  });
});

describe("classifier", () => {
  it("detects debugging", () => {
    expect(classify({ prompt: "help me fix this bug, it throws an error" }).workMode).toBe("debugging");
  });
  it("detects writing/docs", () => {
    expect(classify({ prompt: "write the README documentation" }).workMode).toBe("writing/docs");
  });
  it("detects planning", () => {
    expect(classify({ prompt: "let's plan the architecture and design the schema" }).workMode).toBe(
      "planning/architecture",
    );
  });
  it("defaults to deep-focus coding with low confidence", () => {
    const r = classify({ prompt: "ok" });
    expect(r.workMode).toBe("deep-focus coding");
    expect(r.confidence).toBeLessThan(0.6);
  });
  it("uses tool signal for reading", () => {
    expect(classify({ tool_name: "Read" }).workMode).toBe("code review / reading");
  });
});

describe("ranker", () => {
  const cfg = DEFAULT_CONFIG;
  function mkTrack(i: number, artist: string): TrackCandidate {
    return { uri: `spotify:track:${i}`, id: String(i), artistId: artist, genres: ["ambient"], source: "search" };
  }

  it("hard-filters banned tracks and respects artist diversity", () => {
    const state = freshState();
    state.global.banned.tracks.push("spotify:track:0");
    const profile = newProfile("deep-focus");
    const candidates = Array.from({ length: 30 }, (_, i) => mkTrack(i, i < 10 ? "A" : `art${i}`));
    const ranked = rankCandidates(candidates, profile, state, cfg);
    expect(ranked.find((r) => r.candidate.uri === "spotify:track:0")).toBeUndefined();

    const queue = buildQueue(ranked, profile, cfg, () => 0.99); // deterministic: always exploit
    // no more than max_per_artist consecutive from the same artist
    let run = 1;
    for (let i = 1; i < queue.length; i++) {
      run = queue[i].artistId === queue[i - 1].artistId ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(cfg.selection.max_per_artist);
    }
  });
});
