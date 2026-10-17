import type { StorageLike } from "../settings/display-settings";

/**
 * The v2 board is opt-in while the public room endpoint is being migrated.
 * This key is deliberately separate from display settings so changing a
 * visual preference cannot silently change the wire protocol used by a room.
 */
export const V2_UI_SWITCH_STORAGE_KEY = "riftbound.desktop-client.protocol-v2-ui";

export function readV2UiEnabled(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(V2_UI_SWITCH_STORAGE_KEY) === "enabled";
  } catch {
    return false;
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
