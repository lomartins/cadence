import { getAccessToken, refresh } from "./tokens.js";
import { log } from "../shared/log.js";

const BASE = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Spotify ${status}: ${body}`);
    this.name = "SpotifyError";
    this.status = status;
    this.body = body;
  }
}

export class PremiumRequiredError extends Error {
  constructor() {
    super("Spotify Premium is required for playback control");
    this.name = "PremiumRequiredError";
  }
}

export class NoActiveDeviceError extends Error {
  constructor() {
    super("No active Spotify device");
    this.name = "NoActiveDeviceError";
  }
}

export class RateLimitedError extends Error {
  retryAfter: number;
  constructor(retryAfter: number) {
    super(`Spotify rate limited (retry after ${retryAfter}s)`);
    this.name = "RateLimitedError";
    this.retryAfter = retryAfter;
  }
}

interface ReqOpts {
  method?: "GET" | "PUT" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  retried?: boolean;
}

function buildUrl(path: string, query?: ReqOpts["query"]): string {
  const url = new URL(path.startsWith("http") ? path : BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Core request with: bearer injection, one 401 refresh-and-retry, 429
// Retry-After honoring (capped), 204/empty-body handling, premium/device errors.
async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { method = "GET", body, query, retried = false } = opts;
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, query), { method, headers, body: payload });

  if (res.status === 204) return undefined as T;

  if (res.status === 401 && !retried) {
    log("debug", "401 -> refresh and retry", { path });
    // let refresh failures (NeedsAuthError, network/5xx) propagate — never
    // retry with the same expired token, which would mask the real cause.
    await refresh();
    return request<T>(path, { ...opts, retried: true });
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "1");
    const waitMs = Math.min(retryAfter * 1000 + 250, 30_000);
    log("warn", "429 rate limited", { path, retryAfter, retried });
    if (!retried) {
      await sleep(waitMs);
      return request<T>(path, { ...opts, retried: true });
    }
    throw new RateLimitedError(retryAfter);
  }

  const text = await res.text().catch(() => "");

  if (res.status === 403 && /premium/i.test(text)) throw new PremiumRequiredError();
  if (res.status === 404 && /NO_ACTIVE_DEVICE/i.test(text)) throw new NoActiveDeviceError();

  if (!res.ok) throw new SpotifyError(res.status, text);

  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

export const apiGet = <T>(path: string, query?: ReqOpts["query"]) =>
  request<T>(path, { method: "GET", query });
export const apiPut = <T>(path: string, body?: unknown, query?: ReqOpts["query"]) =>
  request<T>(path, { method: "PUT", body, query });
export const apiPost = <T>(path: string, body?: unknown, query?: ReqOpts["query"]) =>
  request<T>(path, { method: "POST", body, query });
export const apiDelete = <T>(path: string, body?: unknown, query?: ReqOpts["query"]) =>
  request<T>(path, { method: "DELETE", body, query });
