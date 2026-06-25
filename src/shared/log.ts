import { appendFile } from "node:fs/promises";
import { logPath } from "./paths.js";

let DEBUG = false;

export function setDebug(on: boolean): void {
  DEBUG = on;
}

type Level = "debug" | "info" | "warn" | "error";

// Append-only debug logger. NEVER writes to stdout (stdout is the MCP/stdio
// channel for the server and the context channel for SessionStart hooks).
export function log(level: Level, msg: string, meta?: unknown): void {
  if (!DEBUG && level === "debug") return;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(meta !== undefined ? { meta } : {}),
    }) + "\n";
  // fire-and-forget; logging must never throw into the hot path.
  appendFile(logPath(), line).catch(() => {});
}
