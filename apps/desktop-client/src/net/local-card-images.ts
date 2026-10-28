/**
 * Local card-image cache bridge (RIFT-1129).
 *
 * In the Tauri desktop shell, card art is served from the app-data directory
 * through the `rbimg` URI scheme (see `src-tauri/src/card_images.rs`). The
 * remote URL travels along as `src`, so a printing that is not cached yet is
 * downloaded once, stored, and read locally from then on. In a plain browser
 * (the web build and tests) there is no bridge and every URL is unchanged.
 */

export const LOCAL_CARD_IMAGE_SCHEME = "rbimg";
export const CARD_IMAGE_PROGRESS_EVENT = "card-images-progress";

const SAFE_PRINTING_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export interface CardImagePrefetchItem {
  readonly id: string;
  readonly url: string;
}

export interface CardImagePrefetchProgress {
  readonly total: number;
  readonly cached: number;
  readonly failed: number;
  readonly running: boolean;
  readonly cancelled: boolean;
}

export interface LocalCardImageBridge {
  readonly convertFileSrc: (path: string, protocol: string) => string;
  readonly invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly listen: (
    event: string,
    handler: (event: { payload: unknown }) => void
  ) => Promise<() => void>;
}

interface TauriGlobal {
  readonly core?: {
    readonly invoke?: LocalCardImageBridge["invoke"];
    readonly convertFileSrc?: LocalCardImageBridge["convertFileSrc"];
  };
  readonly event?: { readonly listen?: LocalCardImageBridge["listen"] };
}

export function localCardImageBridge(
  scope: unknown = typeof window === "undefined" ? undefined : window
): LocalCardImageBridge | null {
  const tauri = (scope as { __TAURI__?: TauriGlobal } | undefined)?.__TAURI__;
  const invoke = tauri?.core?.invoke;
  const convertFileSrc = tauri?.core?.convertFileSrc;
  const listen = tauri?.event?.listen;
  if (typeof invoke !== "function" || typeof convertFileSrc !== "function" ||
      typeof listen !== "function") {
    return null;
  }
  return { invoke, convertFileSrc, listen };
}

/**
 * Returns the local-cache URL for a printing when running in the desktop
 * shell; otherwise (or for an unusable id/URL) the remote URL unchanged.
 */
export function preferLocalCardImage(
  printingId: string,
  remoteUrl: string | null,
  bridge: LocalCardImageBridge | null = localCardImageBridge()
): string | null {
  if (bridge === null || !remoteUrl || !SAFE_PRINTING_ID.test(printingId)) {
    return remoteUrl;
  }
  return `${bridge.convertFileSrc(printingId, LOCAL_CARD_IMAGE_SCHEME)}?src=${encodeURIComponent(remoteUrl)}`;
}

/** Official image per printing, as listed by the catalog. */
export function cardImagePrefetchItems(
  cards: readonly { readonly id: string; readonly imageUrl: string | null }[]
): CardImagePrefetchItem[] {
  const seen = new Set<string>();
  const items: CardImagePrefetchItem[] = [];
  for (const card of cards) {
    if (!card.imageUrl || !SAFE_PRINTING_ID.test(card.id) || seen.has(card.id)) continue;
    seen.add(card.id);
    items.push({ id: card.id, url: card.imageUrl });
  }
  return items;
}

export function parseCardImagePrefetchProgress(value: unknown): CardImagePrefetchProgress | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const count = (key: string) =>
    typeof record[key] === "number" && Number.isInteger(record[key]) && (record[key] as number) >= 0;
  if (!count("total") || !count("cached") || !count("failed") ||
      typeof record.running !== "boolean" || typeof record.cancelled !== "boolean") {
    return null;
  }
  return {
    total: record.total as number,
    cached: record.cached as number,
    failed: record.failed as number,
    running: record.running,
    cancelled: record.cancelled
  };
}
