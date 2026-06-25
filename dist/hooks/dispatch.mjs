import { createRequire as __cadenceRequire } from 'node:module'; const require = __cadenceRequire(import.meta.url);

// src/shared/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
function dataDir() {
  const override = process.env.CADENCE_DATA_DIR_OVERRIDE?.trim();
  if (override) return override;
  const pluginData = process.env.CADENCE_DATA_DIR?.trim();
  if (pluginData) return pluginData;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "cadence");
  return join(homedir(), ".config", "cadence");
}
var d = () => dataDir();
var cacheDir = () => join(d(), "cache");
var sockPath = () => join(d(), "cadence.sock");
var spoolPath = () => join(d(), "spool.jsonl");
function ensureDirs() {
  for (const dir of [d(), cacheDir()]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
    }
  }
}

// src/shared/ipc.ts
import net from "node:net";
function encode(msg) {
  return JSON.stringify(msg) + "\n";
}
function sendIpc(sock, msg, opts = {}) {
  const { timeoutMs = 400, expectResponse = false } = opts;
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buf = "";
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(val);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(err);
    };
    client.setTimeout(timeoutMs, () => fail(new Error("ipc timeout")));
    client.on("error", fail);
    client.on("connect", () => {
      client.write(encode(msg));
      if (!expectResponse) {
        client.end();
        done(null);
      }
    });
    client.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        try {
          done(JSON.parse(buf.slice(0, nl)));
        } catch {
          done(null);
        }
      }
    });
    client.on("end", () => done(null));
  });
}

// src/shared/atomic.ts
import { readFile, writeFile, rename, appendFile } from "node:fs/promises";
async function appendLine(path, obj) {
  await appendFile(path, JSON.stringify(obj) + "\n", "utf8");
}

// src/hooks/dispatch.ts
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(data);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => data += c);
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 250);
  });
}
async function main() {
  const kind = process.argv[2] ?? "prompt";
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
  }
  const sock = sockPath();
  if (kind === "now-playing") {
    try {
      const res = await sendIpc(sock, { type: "now-playing", payload: { session_id: input.session_id ?? "primary" } }, {
        expectResponse: true,
        timeoutMs: 700
      });
      const banner = res?.banner ?? "\u{1F3A7} Cadence ready.";
      printBanner(banner);
    } catch {
      printBanner("\u{1F3A7} Cadence ready. Run /cadence connect to enable focus music.");
    }
    process.exit(0);
  }
  const event = {
    kind: kind === "tool" ? "tool" : kind === "session-end" ? "session-end" : "prompt",
    session_id: input.session_id ?? "primary",
    cwd: input.cwd ?? process.cwd(),
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    prompt: input.prompt,
    tool_name: input.tool_name,
    tool_input: input.tool_input
  };
  const msg = { type: "event", payload: event };
  try {
    await sendIpc(sock, msg, { timeoutMs: 200 });
  } catch {
    try {
      ensureDirs();
      await appendLine(spoolPath(), msg);
    } catch {
    }
  }
  process.exit(0);
}
function printBanner(banner) {
  const out = {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: banner }
  };
  process.stdout.write(JSON.stringify(out));
}
main().catch(() => process.exit(0));
