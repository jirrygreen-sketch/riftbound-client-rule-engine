import type { StorageLike } from "../settings/display-settings";

/**
 * The v2 board is the default room route (RIFT-1125); a stored "disabled"
 * keeps a player on the legacy room UI. This key is deliberately separate from
 * display settings so changing a visual preference cannot silently change the
 * wire protocol used by a room.
 */
export const V2_UI_SWITCH_STORAGE_KEY = "riftbound.desktop-client.protocol-v2-ui";

export function readV2UiEnabled(storage: StorageLike | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(V2_UI_SWITCH_STORAGE_KEY) !== "disabled";
  } catch {
    return true;
  }
}

export function writeV2UiEnabled(storage: StorageLike | null, enabled: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(V2_UI_SWITCH_STORAGE_KEY, enabled ? "enabled" : "disabled");
    return true;
  } catch {
    return false;
  }
}
