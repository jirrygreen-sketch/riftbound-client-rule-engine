import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CARD_IMAGE_PROGRESS_EVENT,
  cardImagePrefetchItems,
  localCardImageBridge,
  parseCardImagePrefetchProgress,
  type CardImagePrefetchProgress,
  type LocalCardImageBridge
} from "../net/local-card-images";

/**
 * Background download of the official card art into the desktop client's
 * local image cache (RIFT-1129). It starts once a catalog is available and can
 * be paused/resumed from the settings page. Outside the desktop shell it is
 * inert (`supported: false`).
 */
export interface LocalCardImagesState {
  readonly supported: boolean;
  readonly progress: CardImagePrefetchProgress | null;
  readonly error: string | null;
  readonly pause: () => void;
  readonly resume: () => void;
}

export function useLocalCardImages(
  cards: readonly { readonly id: string; readonly imageUrl: string | null }[] | null,
  bridgeOverride?: LocalCardImageBridge | null
): LocalCardImagesState {
  const bridge = useMemo(
    () => (bridgeOverride === undefined ? localCardImageBridge() : bridgeOverride),
    [bridgeOverride]
  );
  const [progress, setProgress] = useState<CardImagePrefetchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const items = useMemo(() => (cards === null ? [] : cardImagePrefetchItems(cards)), [cards]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (bridge === null) return undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void bridge.listen(CARD_IMAGE_PROGRESS_EVENT, event => {
      const next = parseCardImagePrefetchProgress(event.payload);
      if (next !== null) setProgress(next);
    }).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bridge]);

  const start = useCallback(() => {
    if (bridge === null || itemsRef.current.length === 0) return;
    setError(null);
    // The native side queues a start that arrives while a paused run is
    // still stopping, so one call is always enough.
    void bridge.invoke("prefetch_card_images", { items: itemsRef.current })
      .catch(caught => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [bridge]);

  useEffect(() => {
    if (!paused && items.length > 0) start();
  }, [items, paused, start]);

  const pause = useCallback(() => {
    setPaused(true);
    if (bridge !== null) {
      void bridge.invoke("cancel_card_image_prefetch").catch(() => undefined);
    }
  }, [bridge]);

  const resume = useCallback(() => {
    // Un-pausing re-runs the auto-start effect; when not paused (a finished
    // run with failures), start a retry directly.
    if (paused) setPaused(false);
    else start();
  }, [paused, start]);

  return { supported: bridge !== null, progress, error, pause, resume };
}
