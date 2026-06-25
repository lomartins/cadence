import { clientId } from "../config/load.js";
import { loadRefreshToken, saveRefreshToken, clearRefreshToken } from "./secrets.js";
import { log } from "../shared/log.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

export class NeedsAuthError extends Error {
  constructor(msg = "Spotify authorization required") {
    super(msg);
    this.name = "NeedsAuthError";
  }
}

interface TokenState {
  accessToken: string | null;
  expiresAt: number; // epoch ms
}

const state: TokenState = { accessToken: null, expiresAt: 0 };

// Called by the auth flow once a code is exchanged.
export async function setTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
): Promise<void> {
  state.accessToken = accessToken;
  state.expiresAt = Date.now() + expiresIn * 1000;
  if (refreshToken) await saveRefreshToken(refreshToken);
}

export async function hasRefreshToken(): Promise<boolean> {
  return (await loadRefreshToken()) !== null;
}

// Refresh the access token using the stored refresh token (PKCE: client_id in
// the body, no Basic auth header). On invalid_grant the refresh token is dead
// (expired at 6 months or revoked) -> require a fresh authorize.
export async function refresh(): Promise<void> {
  const cid = clientId();
  if (!cid) throw new NeedsAuthError("CADENCE_CLIENT_ID not configured");
  const rt = await loadRefreshToken();
  if (!rt) throw new NeedsAuthError("No refresh token stored");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: cid,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 400 && /invalid_grant/.test(text)) {
      await clearRefreshToken();
      throw new NeedsAuthError("Refresh token expired or revoked — reconnect with /cadence connect");
    }
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  state.accessToken = json.access_token;
  state.expiresAt = Date.now() + json.expires_in * 1000;
  // Spotify may rotate the refresh token; persist the new one if present.
  if (json.refresh_token) await saveRefreshToken(json.refresh_token);
  log("debug", "access token refreshed");
}

// Get a valid access token, refreshing proactively within 60s of expiry.
export async function getAccessToken(): Promise<string> {
  if (state.accessToken && Date.now() < state.expiresAt - 60_000) {
    return state.accessToken;
  }
  await refresh();
  if (!state.accessToken) throw new NeedsAuthError();
  return state.accessToken;
}

export function clearMemory(): void {
  state.accessToken = null;
  state.expiresAt = 0;
}

export async function logout(): Promise<void> {
  clearMemory();
  await clearRefreshToken();
}
