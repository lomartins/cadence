import type { CadenceConfig } from "../shared/types.js";
import { DEFAULT_CONFIG, coerceVibe } from "./defaults.js";
import { configPath, ensureDirs } from "../shared/paths.js";
import { readJson, writeJsonAtomic } from "../shared/atomic.js";

function envBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

// Deep-merge a partial config over the defaults (one level deep for the nested
// option groups is enough — they are flat records of primitives).
function mergeConfig(base: CadenceConfig, over: Partial<CadenceConfig>): CadenceConfig {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const k of Object.keys(over) as (keyof CadenceConfig)[]) {
    const val = over[k];
    if (val === undefined || val === null) continue;
    if (typeof val === "object" && !Array.isArray(val)) {
      out[k] = { ...(out[k] as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else {
      out[k] = val as unknown;
    }
  }
  return out as unknown as CadenceConfig;
}

let cached: CadenceConfig | null = null;

// Load config.json (creating it from defaults on first run), then layer
// env-injected userConfig on top (env wins for the handful of plugin options).
export async function loadConfig(force = false): Promise<CadenceConfig> {
  if (cached && !force) return cached;
  ensureDirs();

  const onDisk = await readJson<Partial<CadenceConfig>>(configPath(), {});
  let cfg = mergeConfig(DEFAULT_CONFIG, onDisk);

  // env overrides from .mcp.json (only when actually provided & non-empty)
  const env = process.env;
  const envPort = Number(env.CADENCE_AUTH_PORT?.trim());
  cfg = mergeConfig(cfg, {
    market: env.CADENCE_MARKET?.trim() || cfg.market,
    default_vibe: coerceVibe(env.CADENCE_DEFAULT_VIBE?.trim(), cfg.default_vibe),
    auto_switch: envBool(env.CADENCE_AUTO_SWITCH, cfg.auto_switch),
    enable_local_fallback: envBool(env.CADENCE_LOCAL_FALLBACK, cfg.enable_local_fallback),
    auth_port: Number.isFinite(envPort) && envPort > 0 ? envPort : cfg.auth_port,
  });

  // persist defaults on first run so users have a file to tune
  if (Object.keys(onDisk).length === 0) {
    await writeJsonAtomic(configPath(), cfg).catch(() => {});
  }

  cached = cfg;
  return cfg;
}

export async function saveConfig(cfg: CadenceConfig): Promise<void> {
  cached = cfg;
  await writeJsonAtomic(configPath(), cfg);
}

export function clientId(): string | undefined {
  return process.env.CADENCE_CLIENT_ID?.trim() || undefined;
}
