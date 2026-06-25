import type { CadenceConfig, Intensity, SessionState, VibeSlug, WorkMode } from "../shared/types.js";
import { vibeForWorkMode, defaultIntensity } from "../data/curation.js";

const sessions = new Map<string, SessionState>();

export function getSession(sessionId: string, cfg: CadenceConfig): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    const vibe = cfg.default_vibe;
    s = {
      session_id: sessionId,
      auto_switch: cfg.auto_switch,
      current_mode: "deep-focus coding",
      current_vibe: vibe,
      intensity: defaultIntensity(vibe),
      last_switch_ts: 0,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

export function setAuto(sessionId: string, cfg: CadenceConfig, mode: "on" | "off" | "toggle"): boolean {
  const s = getSession(sessionId, cfg);
  s.auto_switch = mode === "toggle" ? !s.auto_switch : mode === "on";
  return s.auto_switch;
}

export function setVibe(sessionId: string, cfg: CadenceConfig, vibe: VibeSlug, intensity?: Intensity): void {
  const s = getSession(sessionId, cfg);
  s.current_vibe = vibe;
  s.intensity = intensity ?? defaultIntensity(vibe);
  s.last_switch_ts = Date.now();
}

export function setIntensity(sessionId: string, cfg: CadenceConfig, intensity: Intensity): void {
  getSession(sessionId, cfg).intensity = intensity;
}

// Decide whether an auto-detected work mode should actually switch the music:
// auto-switch on, the mode genuinely changed, confidence clears the bar, and
// enough time has passed since the last switch (debounce).
export function shouldSwitch(
  sessionId: string,
  cfg: CadenceConfig,
  newMode: WorkMode,
  confidence: number,
  now = Date.now(),
): { switch: boolean; vibe: VibeSlug; reason: string } {
  const s = getSession(sessionId, cfg);
  const vibe = vibeForWorkMode(newMode);
  if (!s.auto_switch) return { switch: false, vibe, reason: "auto-switch off" };
  if (confidence < cfg.autoswitch.confidence)
    return { switch: false, vibe, reason: `low confidence ${confidence.toFixed(2)}` };
  if (vibe === s.current_vibe) return { switch: false, vibe, reason: "same vibe" };
  const elapsed = (now - s.last_switch_ts) / 1000;
  if (s.last_switch_ts > 0 && elapsed < cfg.autoswitch.debounce_seconds)
    return { switch: false, vibe, reason: `debounced (${elapsed.toFixed(0)}s)` };
  return { switch: true, vibe, reason: `mode -> ${newMode}` };
}

export function applySwitch(sessionId: string, cfg: CadenceConfig, mode: WorkMode, vibe: VibeSlug): void {
  const s = getSession(sessionId, cfg);
  s.current_mode = mode;
  s.current_vibe = vibe;
  s.intensity = defaultIntensity(vibe);
  s.last_switch_ts = Date.now();
}
