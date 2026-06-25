import http from "node:http";
import { spawn } from "node:child_process";
import { clientId } from "../config/load.js";
import { genVerifier, challengeFromVerifier, genState } from "./pkce.js";
import { setTokens, NeedsAuthError } from "./tokens.js";
import { log } from "../shared/log.js";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Minimal scopes — exactly the endpoints Cadence calls (playback control +
// read-only taste signals). Add more only when a backing call is implemented.
export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
].join(" ");

interface Pending {
  verifier: string;
  state: string;
  redirectUri: string;
}
let pending: Pending | null = null;
// closes the loopback server + clears the timeout for the in-flight flow
let activeCleanup: (() => void) | null = null;

export interface AuthHandle {
  url: string;
  done: Promise<void>;
  cancel(): void;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", () => {});
  } catch {
    /* headless / sandboxed — user uses the printed URL */
  }
}

async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<void> {
  const cid = clientId();
  if (!cid) throw new NeedsAuthError("CADENCE_CLIENT_ID not configured");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cid,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  await setTokens(json.access_token, json.refresh_token, json.expires_in);
  log("info", "spotify connected");
}

function buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
  const cid = clientId();
  if (!cid) throw new NeedsAuthError("CADENCE_CLIENT_ID not configured");
  const p = new URLSearchParams({
    client_id: cid,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Start a loopback listener on the configured fixed port, return the authorize
// URL and a promise that resolves once Spotify redirects back and the code is
// exchanged. Register the redirect URI in the Spotify dashboard as exactly
// http://127.0.0.1:<port>/callback (loopback IPv4 — localhost is not allowed).
export async function beginAuth(port = 8888, timeoutMs = 300_000): Promise<AuthHandle> {
  const cid = clientId();
  if (!cid) throw new NeedsAuthError("CADENCE_CLIENT_ID not configured");

  const verifier = genVerifier();
  const challenge = challengeFromVerifier(verifier);
  const state = genState();

  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const gotState = reqUrl.searchParams.get("state");
      const err = reqUrl.searchParams.get("error");
      if (err) throw new Error(`Spotify denied authorization: ${err}`);
      if (!code || gotState !== state) throw new Error("Invalid callback (state mismatch)");

      const redirectUri = pending!.redirectUri;
      await exchangeCode(code, redirectUri, verifier);

      res.writeHead(200, { "Content-Type": "text/html" }).end(SUCCESS_HTML);
      cleanup();
      resolveDone();
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/html" }).end(failHtml(String(e)));
      cleanup();
      rejectDone(e instanceof Error ? e : new Error(String(e)));
    }
  });

  let timer: NodeJS.Timeout;
  const cleanup = () => {
    clearTimeout(timer);
    server.close();
    pending = null;
    activeCleanup = null;
  };
  activeCleanup = cleanup;

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is in use. Free it, or set a different auth_port in the plugin config and register http://127.0.0.1:<port>/callback in your Spotify app.`,
          ),
        );
      } else {
        reject(e);
      }
    };
    server.once("error", onErr);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onErr);
      resolve();
    });
  });
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  pending = { verifier, state, redirectUri };

  const url = buildAuthorizeUrl(redirectUri, challenge, state);
  timer = setTimeout(() => {
    cleanup();
    rejectDone(new Error("Authorization timed out"));
  }, timeoutMs);

  openBrowser(url);
  log("info", "auth flow started", { redirectUri });

  return {
    url,
    done,
    cancel: () => {
      cleanup();
      rejectDone(new Error("cancelled"));
    },
  };
}

// Manual fallback for headless/SSH: user pastes the full redirected URL.
export async function completeWithRedirectUrl(fullUrl: string): Promise<void> {
  if (!pending) throw new Error("No auth flow in progress — run connect first");
  const u = new URL(fullUrl);
  const code = u.searchParams.get("code");
  const gotState = u.searchParams.get("state");
  if (!code || gotState !== pending.state) throw new Error("Invalid redirect URL (state mismatch)");
  await exchangeCode(code, pending.redirectUri, pending.verifier);
  // tear down the still-open loopback listener + timeout from beginAuth
  activeCleanup?.();
}

const SUCCESS_HTML = `<!doctype html><meta charset=utf-8><title>Cadence connected</title>
<body style="font-family:system-ui;background:#0B0D18;color:#EAEAFF;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:48px">🎧</div>
<h1 style="font-weight:800">Cadence is connected</h1>
<p style="color:#8A91B4">You can close this tab and return to Claude Code.</p></div></body>`;

function failHtml(msg: string): string {
  return `<!doctype html><meta charset=utf-8><title>Cadence error</title>
<body style="font-family:system-ui;background:#0B0D18;color:#EAEAFF;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:48px">⚠️</div>
<h1>Authorization failed</h1><pre style="color:#8A91B4">${msg.replace(/</g, "&lt;")}</pre></div></body>`;
}
