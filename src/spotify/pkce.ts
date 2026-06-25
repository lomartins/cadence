import { randomBytes, createHash } from "node:crypto";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 43–128 char verifier from the unreserved set. base64url output is exactly the
// PKCE unreserved alphabet (A-Za-z0-9-_), so this is unbiased — no modulo.
export function genVerifier(length = 64): string {
  // 48 random bytes -> 64 base64url chars
  return base64url(randomBytes(48)).slice(0, length);
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function genState(): string {
  return base64url(randomBytes(24));
}
