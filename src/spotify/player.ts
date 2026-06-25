import { apiGet, apiPut, apiPost, NoActiveDeviceError } from "./client.js";
import type { Device } from "../shared/types.js";
import { log } from "../shared/log.js";

interface DevicesResp {
  devices: Device[];
}
interface PlaybackResp {
  is_playing: boolean;
  device?: Device;
  item?: { uri: string; name: string; artists: Array<{ name: string }> };
}

export async function devices(): Promise<Device[]> {
  const r = await apiGet<DevicesResp>("/me/player/devices");
  return r?.devices ?? [];
}

// GET /me/player returns 204 (undefined here) when nothing is active.
export async function state(): Promise<PlaybackResp | null> {
  const r = await apiGet<PlaybackResp>("/me/player");
  return r ?? null;
}

export async function transferTo(deviceId: string, play = true): Promise<void> {
  await apiPut("/me/player", { device_ids: [deviceId], play });
}

// Return an active device id, waking the first available one if necessary.
export async function ensureActiveDevice(): Promise<string> {
  const list = await devices();
  const active = list.find((d) => d.is_active);
  if (active) return active.id;
  if (list.length === 0) throw new NoActiveDeviceError();
  await transferTo(list[0].id, false);
  log("info", "transferred playback to wake device", { device: list[0].name });
  return list[0].id;
}

export interface PlayArgs {
  uris?: string[];
  context_uri?: string;
  device_id?: string;
}

export async function play(args: PlayArgs = {}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (args.uris?.length) body.uris = args.uris;
  if (args.context_uri) body.context_uri = args.context_uri;
  try {
    await apiPut("/me/player/play", body, { device_id: args.device_id });
  } catch (e) {
    if (e instanceof NoActiveDeviceError) {
      const id = await ensureActiveDevice();
      await apiPut("/me/player/play", body, { device_id: id });
    } else {
      throw e;
    }
  }
}

export const pause = () => apiPut("/me/player/pause");
export const next = () => apiPost("/me/player/next");
export const previous = () => apiPost("/me/player/previous");
export const volume = (percent: number) =>
  apiPut("/me/player/volume", undefined, {
    volume_percent: Math.max(0, Math.min(100, Math.round(percent))),
  });
export const shuffle = (on: boolean) =>
  apiPut("/me/player/shuffle", undefined, { state: String(on) });
export const queueAdd = (uri: string) =>
  apiPost("/me/player/queue", undefined, { uri });

export async function nowPlaying(): Promise<{ uri?: string; title?: string; artist?: string } | null> {
  const s = await state();
  if (!s?.item) return null;
  return { uri: s.item.uri, title: s.item.name, artist: s.item.artists?.[0]?.name };
}
