import { writeFile, readFile, chmod, unlink } from "node:fs/promises";
import { credentialsPath, ensureDirs } from "../shared/paths.js";
import { log } from "../shared/log.js";

const SERVICE = "cadence";
const ACCOUNT = "spotify-refresh-token";

// Lazy keytar load — it's an optional native dep that may fail to build.
async function tryKeytar(): Promise<typeof import("keytar") | null> {
  try {
    return await import("keytar");
  } catch {
    return null;
  }
}

interface CredFile {
  refresh_token?: string;
}

export async function saveRefreshToken(token: string): Promise<void> {
  const kt = await tryKeytar();
  if (kt) {
    try {
      await kt.setPassword(SERVICE, ACCOUNT, token);
      return;
    } catch (e) {
      log("warn", "keytar setPassword failed, falling back to file", String(e));
    }
  }
  ensureDirs();
  // create with restrictive perms from the start (don't rely on a later chmod)
  await writeFile(credentialsPath(), JSON.stringify({ refresh_token: token }), { mode: 0o600 });
  await chmod(credentialsPath(), 0o600).catch((e) =>
    log("warn", "could not chmod credentials file to 0600 — token may be readable", String(e)),
  );
}

export async function loadRefreshToken(): Promise<string | null> {
  const kt = await tryKeytar();
  if (kt) {
    try {
      const v = await kt.getPassword(SERVICE, ACCOUNT);
      if (v) return v;
    } catch {
      /* fall through to file */
    }
  }
  try {
    const raw = await readFile(credentialsPath(), "utf8");
    return (JSON.parse(raw) as CredFile).refresh_token ?? null;
  } catch {
    return null;
  }
}

export async function clearRefreshToken(): Promise<void> {
  const kt = await tryKeytar();
  if (kt) {
    try {
      await kt.deletePassword(SERVICE, ACCOUNT);
    } catch {
      /* ignore */
    }
  }
  await unlink(credentialsPath()).catch(() => {});
}

// Whether we are storing in the keychain (secure) vs the 0600 file (less so).
export async function usingKeychain(): Promise<boolean> {
  return (await tryKeytar()) !== null;
}
