import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "../shared/log.js";

const execFileP = promisify(execFile);

// Local desktop control fallback (no Premium needed):
//   Linux -> playerctl (MPRIS), targeting the spotify player
//   macOS -> AppleScript controlling the Spotify app
// Windows has no reliable scriptable equivalent.

type Cmd = "play" | "pause" | "play-pause" | "next" | "previous" | "stop";

let availabilityCache: boolean | null = null;

export async function available(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  try {
    if (process.platform === "linux") {
      await execFileP("which", ["playerctl"]);
      availabilityCache = true;
    } else if (process.platform === "darwin") {
      availabilityCache = true; // osascript ships with macOS
    } else {
      availabilityCache = false;
    }
  } catch {
    availabilityCache = false;
  }
  return availabilityCache;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore" });
      child.on("error", (e) => {
        log("warn", "local control spawn error", String(e));
        resolve();
      });
      child.on("close", () => resolve());
    } catch (e) {
      log("warn", "local control failed", String(e));
      resolve();
    }
  });
}

const APPLESCRIPT: Record<Cmd, string> = {
  play: 'tell application "Spotify" to play',
  pause: 'tell application "Spotify" to pause',
  "play-pause": 'tell application "Spotify" to playpause',
  next: 'tell application "Spotify" to next track',
  previous: 'tell application "Spotify" to previous track',
  stop: 'tell application "Spotify" to pause',
};

async function control(cmd: Cmd): Promise<void> {
  if (!(await available())) return;
  if (process.platform === "linux") {
    await run("playerctl", ["--player=spotify", cmd]);
  } else if (process.platform === "darwin") {
    await run("osascript", ["-e", APPLESCRIPT[cmd]]);
  }
}

export const play = () => control("play");
export const pause = () => control("pause");
export const playPause = () => control("play-pause");
export const next = () => control("next");
export const previous = () => control("previous");

export async function status(): Promise<{ playing: boolean; title?: string; artist?: string } | null> {
  if (!(await available())) return null;
  try {
    if (process.platform === "linux") {
      const { stdout } = await execFileP("playerctl", [
        "--player=spotify",
        "metadata",
        "--format",
        "{{status}}\t{{title}}\t{{artist}}",
      ]);
      const [st, title, artist] = stdout.trim().split("\t");
      return { playing: st === "Playing", title, artist };
    }
    if (process.platform === "darwin") {
      const { stdout } = await execFileP("osascript", [
        "-e",
        'tell application "Spotify" to return (player state as text) & "\t" & (name of current track) & "\t" & (artist of current track)',
      ]);
      const [st, title, artist] = stdout.trim().split("\t");
      return { playing: st === "playing", title, artist };
    }
  } catch {
    return null;
  }
  return null;
}
