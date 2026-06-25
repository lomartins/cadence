import { randomBytes, createHash } from "node:crypto";

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 43–128 char verifier from the unreserved set (Spotify recommends 64).
export function genVerifier(length = 64): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += VERIFIER_CHARS[bytes[i] % VERIFIER_CHARS.length];
  return out;
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function genState(): string {
  return base64url(randomBytes(24));
}
