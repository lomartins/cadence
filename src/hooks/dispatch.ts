// Ultra-thin hook client. Reads the hook's stdin JSON, sends one IPC message to
// the running Cadence MCP brain over a Unix socket, and exits. Never blocks the
// Claude Code turn: on any failure it spools the event (or prints a static
// banner) and exits 0.

import { sockPath, spoolPath, ensureDirs } from "../shared/paths.js";
import { sendIpc } from "../shared/ipc.js";
import { appendLine } from "../shared/atomic.js";
import type { HookEvent, IpcMessage } from "../shared/types.js";

function readStdin(): Promise<string> {
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
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    // safety: never wait on stdin forever
    setTimeout(finish, 250);
  });
}

interface HookStdin {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: unknown;
}

async function main(): Promise<void> {
  const kind = (process.argv[2] ?? "prompt") as HookEvent["kind"] | "now-playing";
  const raw = await readStdin();
  let input: HookStdin = {};
  try {
    input = raw ? (JSON.parse(raw) as HookStdin) : {};
  } catch {
    /* tolerate empty/non-JSON */
  }

  const sock = sockPath();

  if (kind === "now-playing") {
    // SessionStart banner: request/response, short timeout, static fallback.
    try {
      const res = await sendIpc(sock, { type: "now-playing", payload: { session_id: input.session_id ?? "primary" } }, {
        expectResponse: true,
        timeoutMs: 700,
      });
      const banner = res?.banner ?? "🎧 Cadence ready.";
      printBanner(banner);
    } catch {
      printBanner("🎧 Cadence ready. Run /cadence connect to enable focus music.");
    }
    process.exit(0);
  }

  const event: HookEvent = {
    kind: (kind === "tool" ? "tool" : kind === "session-end" ? "session-end" : "prompt"),
    session_id: input.session_id ?? "primary",
    cwd: input.cwd ?? process.cwd(),
    ts: new Date().toISOString(),
    prompt: input.prompt,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
  };
  const msg: IpcMessage = { type: "event", payload: event };

  try {
    await sendIpc(sock, msg, { timeoutMs: 200 });
  } catch {
    // brain not up yet — spool for it to drain on connect
    try {
      ensureDirs();
      await appendLine(spoolPath(), msg);
    } catch {
      /* give up silently */
    }
  }
  process.exit(0);
}

function printBanner(banner: string): void {
  // SessionStart stdout becomes Claude context.
  const out = {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: banner },
  };
  process.stdout.write(JSON.stringify(out));
}

main().catch(() => process.exit(0));
