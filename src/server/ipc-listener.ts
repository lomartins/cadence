import net from "node:net";
import { unlink, readFile, writeFile } from "node:fs/promises";
import { sockPath, spoolPath, ensureDirs } from "../shared/paths.js";
import { decode } from "../shared/ipc.js";
import type { HookEvent, IpcResponse } from "../shared/types.js";
import * as H from "./handlers.js";
import { log } from "../shared/log.js";

async function handleEvent(ev: HookEvent): Promise<void> {
  try {
    const msg = await H.doDetectAndSwitch(ev);
    if (msg) log("info", msg);
  } catch (e) {
    log("warn", "hook event handling failed", String(e));
  }
}

// Process any events buffered while the socket was down (e.g. SessionStart
// fired before the MCP server finished connecting).
async function drainSpool(): Promise<void> {
  let raw = "";
  try {
    raw = await readFile(spoolPath(), "utf8");
  } catch {
    return;
  }
  if (!raw.trim()) return;
  await writeFile(spoolPath(), "", "utf8").catch(() => {});
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const msg = decode(line);
    if (msg?.type === "event") await handleEvent(msg.payload);
  }
  log("info", "drained hook spool");
}

export async function startIpcListener(): Promise<net.Server> {
  ensureDirs();
  // remove any stale socket from a previous run
  await unlink(sockPath()).catch(() => {});

  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const msg = decode(line);
        if (!msg) continue;
        if (msg.type === "event") {
          void handleEvent(msg.payload);
        } else if (msg.type === "now-playing") {
          H.buildNowPlayingBanner(H.SESSION)
            .then((banner) => {
              const res: IpcResponse = { ok: true, banner };
              conn.write(JSON.stringify(res) + "\n");
            })
            .catch(() => {
              conn.write(JSON.stringify({ ok: false } satisfies IpcResponse) + "\n");
            });
        } else if (msg.type === "ping") {
          conn.write(JSON.stringify({ ok: true } satisfies IpcResponse) + "\n");
        }
      }
    });
    conn.on("error", () => {});
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath(), resolve);
  });
  log("info", "ipc listener up", { sock: sockPath() });

  await drainSpool();
  return server;
}
