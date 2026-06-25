import presetsData from "./presets.json" with { type: "json" };
import type {
  AudioFeatureKey,
  AudioPrefs,
  CurationTable,
  Intensity,
  VibeDef,
  VibeSlug,
  WelfordStat,
} from "../shared/types.js";

const CURATION = presetsData as unknown as CurationTable;

export function loadCuration(): CurationTable {
  return CURATION;
}

export function vibeDef(vibe: VibeSlug): VibeDef {
  return CURATION.vibes[vibe];
}

export function vibeForWorkMode(mode: string): VibeSlug {
  return CURATION.workModeToVibe[mode] ?? "deep-focus";
}

export function defaultIntensity(vibe: VibeSlug): Intensity {
  return CURATION.vibes[vibe].defaultIntensity;
}

// Rewrite/extend a vibe's base search queries with the active intensity's
// character. Intensity 0 strips beat-driven genres; >=3 adds driving flavors.
export function applyIntensity(vibe: VibeSlug, intensity: Intensity): string[] {
  const def = CURATION.vibes[vibe];
  const scale = CURATION.intensityScale[String(intensity)];
  let queries = [...def.searchQueries];

  if (intensity === 0) {
    // favour ambient/drone, drop explicitly beat-driven seeds
    queries = queries
      .filter((q) => !/lo-?fi|beats|house|techno|funk|disco|phonk|drum and bass/i.test(q))
      .map((q) => `${q} ambient calm`);
    if (queries.length === 0) queries = ["genre:ambient calm instrumental", "genre:drone peaceful"];
  } else if (intensity >= 3) {
    const flavor = intensity >= 4 ? "epic energetic" : "driving";
    queries = queries.map((q) => `${q} ${flavor}`);
    queries.push(
      intensity >= 4 ? "genre:\"drum and bass\" instrumental" : "genre:synthwave driving",
    );
  }

  // Append a tempo/energy hint so free-text fuzzy matching nudges toward the band.
  if (scale) {
    const hint = `${scale.energy} energy`;
    queries = queries.map((q) => (q.includes("energy") ? q : `${q} ${hint}`));
  }
  return queries;
}

const FEATURE_BAND: Record<AudioFeatureKey, [number, number]> = {
  energy: [0, 1],
  valence: [0, 1],
  danceability: [0, 1],
  acousticness: [0, 1],
  instrumentalness: [0, 1],
  tempo: [40, 200],
  loudness: [-60, 0],
};

function welford(mean: number, n = 8): WelfordStat {
  return { mean, var: 0.05, n };
}

// Seed an audio-intent centroid from a vibe's curated character. Since Spotify's
// live audio-features endpoint is dead for new apps, this preset centroid is the
// initial target the learner nudges with explicit positive feedback.
export function presetCentroid(vibe: VibeSlug): AudioPrefs {
  const a = CURATION.vibes[vibe].audio;
  const energyMap: Record<string, number> = {
    low: 0.25,
    "low-med": 0.4,
    medium: 0.55,
    "med-high": 0.7,
    high: 0.85,
  };
  const valenceMap: Record<string, number> = {
    neutral: 0.5,
    "neutral-warm": 0.55,
    "neutral-positive": 0.6,
    "slightly-positive": 0.6,
    positive: 0.7,
    high: 0.85,
  };
  const instMap: Record<string, number> = {
    optional: 0.4,
    high: 0.8,
    "high-preferred": 0.85,
    max: 0.95,
  };
  const acoustMap: Record<string, number> = {
    low: 0.2,
    mixed: 0.5,
    "med-high": 0.65,
    high: 0.8,
  };
  const bpmMid = (a.bpm[0] + a.bpm[1]) / 2;
  const energy = energyMap[a.energy] ?? 0.5;

  return {
    energy: welford(energy),
    valence: welford(valenceMap[a.valence] ?? 0.5),
    danceability: welford(Math.min(0.9, energy + 0.05)),
    acousticness: welford(acoustMap[a.acousticness] ?? 0.5),
    instrumentalness: welford(instMap[a.instrumentalness] ?? 0.6),
    tempo: welford(bpmMid),
    loudness: welford(-14 + energy * 8),
  };
}

export { FEATURE_BAND };
