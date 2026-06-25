import { readFile, writeFile, rename, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Read JSON, returning `fallback` if the file is missing or unparseable.
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Atomic write: write a temp file then rename over the target. Prevents a
// crash mid-write from corrupting state.json.
export async function writeJsonAtomic(path: string, obj: unknown): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.round(Math.random() * 1e9)}.tmp`);
  await writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await rename(tmp, path);
}

// Append one JSON object as a line (for *.jsonl logs). Durable-first.
export async function appendLine(path: string, obj: unknown): Promise<void> {
  await appendFile(path, JSON.stringify(obj) + "\n", "utf8");
}

// Minimal keyed async mutex so concurrent read-modify-write on state.json
// serializes within the single MCP process.
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // keep the chain alive but swallow rejections so one failure doesn't poison it
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
