import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, chmodSync, writeFileSync, readFileSync } from "node:fs";

// Resolve the Cadence data directory. Priority:
//   1. CADENCE_DATA_DIR_OVERRIDE (user_config.data_dir)
//   2. CADENCE_DATA_DIR (= ${CLAUDE_PLUGIN_DATA}, survives plugin updates)
//   3. CLAUDE_PLUGIN_DATA (injected into hook processes by Claude Code)
//   4. XDG_CONFIG_HOME/cadence
//   5. ~/.config/cadence
// NEVER returns the plugin root — state must survive updates.
export function dataDir(): string {
  const override = process.env.CADENCE_DATA_DIR_OVERRIDE?.trim();
  if (override) return override;
  const explicit = process.env.CADENCE_DATA_DIR?.trim();
  if (explicit) return explicit;
  const pluginData = process.env.CLAUDE_PLUGIN_DATA?.trim();
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

// Create the data dir with owner-only perms (0700) so the credentials fallback,
// state, and the IPC socket are not exposed to other local users.
export function ensureDirs(): void {
  try {
    mkdirSync(d(), { recursive: true, mode: 0o700 });
    // mkdir's mode is ignored if the dir already exists — enforce it.
    chmodSync(d(), 0o700);
  } catch {
    /* best-effort */
  }
  try {
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  } catch {
    /* best-effort */
  }
}

// A fixed pointer at CLAUDE_PLUGIN_DATA so the fast hook dispatcher can find the
// real data dir even when the user set a data_dir override (which only reaches
// the MCP server, not the hooks).
function pointerPath(): string | null {
  const base = process.env.CLAUDE_PLUGIN_DATA?.trim();
  return base ? join(base, ".datadir") : null;
}

export function writeDataDirPointer(): void {
  const ptr = pointerPath();
  if (!ptr) return;
  const resolved = d();
  try {
    if (resolved !== process.env.CLAUDE_PLUGIN_DATA?.trim()) {
      mkdirSync(process.env.CLAUDE_PLUGIN_DATA!.trim(), { recursive: true, mode: 0o700 });
      writeFileSync(ptr, resolved, "utf8");
    }
  } catch {
    /* best-effort */
  }
}

export function readDataDirPointer(): string | null {
  const ptr = pointerPath();
  if (!ptr) return null;
  try {
    const v = readFileSync(ptr, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}
