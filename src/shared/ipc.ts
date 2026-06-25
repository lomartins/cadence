import net from "node:net";
import type { IpcMessage, IpcResponse } from "./types.js";

// Newline-delimited JSON framing over a Unix domain socket. The hook dispatcher
// is the client; the MCP server is the listener.

export function encode(msg: IpcMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decode(line: string): IpcMessage | null {
  try {
    return JSON.parse(line) as IpcMessage;
  } catch {
    return null;
  }
}

export interface SendOptions {
  timeoutMs?: number;
  expectResponse?: boolean;
}

// Connect, send one message, optionally await a one-line JSON response, close.
// Rejects on connection error so callers can fall back to the spool file.
export function sendIpc(
  sock: string,
  msg: IpcMessage,
  opts: SendOptions = {},
): Promise<IpcResponse | null> {
  const { timeoutMs = 400, expectResponse = false } = opts;
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sock);
    let buf = "";
    let settled = false;

    const done = (val: IpcResponse | null) => {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(val);
    };
    const fail = (err: Error) => {
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
          done(JSON.parse(buf.slice(0, nl)) as IpcResponse);
        } catch {
          done(null);
        }
      }
    });

    client.on("end", () => done(null));
  });
}
