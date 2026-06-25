import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

// Resolve the Cadence data directory. Priority:
//   1. CADENCE_DATA_DIR_OVERRIDE (user_config.data_dir)
//   2. CADENCE_DATA_DIR (= ${CLAUDE_PLUGIN_DATA}, survives plugin updates)
//   3. XDG_CONFIG_HOME/cadence
//   4. ~/.config/cadence
// NEVER returns the plugin root — state must survive updates.
export function dataDir(): string {
  const override = process.env.CADENCE_DATA_DIR_OVERRIDE?.trim();
  if (override) return override;
  const pluginData = process.env.CADENCE_DATA_DIR?.trim();
  if (pluginData) return pluginData;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "cadence");
  return join(homedir(), ".config", "cadence");
}

const d = () => dataDir();

export const statePath = () => join(d(), "state.json");
export const feedbackPath = () => join(d(), "feedback.jsonl");
export const configPath = () => join(d(), "config.json");
export const credentialsPath = () => join(d(), "credentials.json");
export const cacheDir = () => join(d(), "cache");
export const cachePath = (name: string) => join(cacheDir(), name);
export const sockPath = () => join(d(), "cadence.sock");
export const spoolPath = () => join(d(), "spool.jsonl");
export const logPath = () => join(d(), "cadence.log");

export function pluginRoot(): string {
  return process.env.CADENCE_PLUGIN_ROOT?.trim() || process.cwd();
}

// presets.json ships inside the plugin (bundled into dist/data by the build).
export function presetsPath(): string {
  return join(pluginRoot(), "dist", "data", "presets.json");
}

export function ensureDirs(): void {
  for (const dir of [d(), cacheDir()]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }
}
