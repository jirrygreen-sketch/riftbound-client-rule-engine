import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CardCatalogClient,
  cardImageServerUrl,
  normalizeCardServerUrl,
  type CardCatalog,
  type CatalogCard
} from "../net/CardCatalogClient";
import { preferLocalCardImage } from "../net/local-card-images";

/**
 * Read-only display catalog for the authoritative 1v1 duel projection.
 *
 * This hook exists for one reason: the live duel names and images must come
 * from a public card catalog whose stamp equals the one the authoritative
 * projection was built from (`DuelProjection.match.dataVersion` /
 * `match.catalogDigest`). The deck editor keeps its own, user-configured
 * catalog address; this hook never reads or writes that preference and never
 * touches draft/validation state. It only resolves `cardId -> {title, imageUrl}`
 * for display, and it is not a rules, cost, or effect authority.
 */
export interface DuelCatalogStamp {
  readonly dataVersion: string;
  readonly catalogDigest: string;
}

export interface DuelCatalogCardView {
  readonly title: string;
  readonly imageUrl: string | null;
  readonly domains: readonly string[];
}

export type DuelCatalogStatus = "idle" | "loading" | "ready" | "error";

export interface DuelCatalogState {
  readonly status: DuelCatalogStatus;
  readonly error: string | null;
  /** HTTP endpoint the catalog was (or would be) loaded from; display only. */
  readonly serverUrl: string | null;
  readonly catalog: CardCatalog | null;
  readonly source: "reused" | "loaded" | null;
}

export interface DuelCatalogTarget {
  readonly serverUrl: string;
  readonly stampKey: string;
}

export interface DuelCatalogRequest {
  readonly generation: number;
  readonly target: DuelCatalogTarget;
}

export interface DuelCatalogLoadOutcome {
  readonly status: "ready" | "error";
  readonly catalog: CardCatalog | null;
  readonly error: string | null;
}

export const DUEL_CATALOG_STAMP_MISMATCH_MESSAGE =
  "对局卡牌目录与当前对局的版本不一致，已停止使用该目录。";

export const DUEL_CATALOG_TIMEOUT_MESSAGE = "加载对局卡牌目录超时，请重试。";

export const DUEL_CATALOG_ENDPOINT_MESSAGE =
  "无法确定当前对局服务的地址，暂时无法加载卡牌名称与图片。";

const DEFAULT_DUEL_CATALOG_ERROR = "无法从当前对局服务加载卡牌目录。";
const DEFAULT_DUEL_CATALOG_TIMEOUT_MS = 15_000;

/**
 * Stable identity of a stamp. The authoritative projection is re-sent on every
 * state change, so a raw object would change identity on every update; the key
 * keeps effect dependencies bound to the actual data version + digest.
 */
export function duelCatalogStampKey(
  stamp: DuelCatalogStamp | null | undefined
): string | null {
  if (!stamp) return null;
  const dataVersion = stamp.dataVersion.trim();
  const catalogDigest = stamp.catalogDigest.trim();
  if (!dataVersion || !catalogDigest) return null;
  return `${stamp.dataVersion}\u0000${stamp.catalogDigest}`;
}

/** Same identity for a loaded catalog, so a fetched catalog can be matched. */
export function catalogStampKey(catalog: CardCatalog): string {
  return `${catalog.dataVersion}\u0000${catalog.digest}`;
}

export function stampMatchesCatalog(
  catalog: CardCatalog | null | undefined,
  stamp: DuelCatalogStamp | null | undefined
): boolean {
  const key = duelCatalogStampKey(stamp);
  if (!catalog || key === null) return false;
  return catalogStampKey(catalog) === key;
}

/**
 * The already-loaded editor catalog may be reused when — and only when — its
 * own stamp equals the live match stamp. Any other catalog is ignored so a
 * stale or differently-configured catalog can never label a duel.
 */
export function reuseDuelCatalog(
  catalog: CardCatalog | null | undefined,
  stamp: DuelCatalogStamp | null | undefined
): CardCatalog | null {
  return stampMatchesCatalog(catalog, stamp) ? catalog ?? null : null;
}

/**
 * Derives the public HTTP catalog endpoint from the transport's active URL.
 * The connected target is a WebSocket URL (`ws://host:port/ws`); the compiled
 * server exposes the read-only `/api/cards` catalog on the same authority, so
 * the scheme is mapped ws->http / wss->https and the path is dropped before the
 * existing `CardCatalogClient` normalizer is applied.
 */
export function duelCatalogServerUrl(
  activeServerUrl: string | null | undefined
): string | null {
  const raw = (activeServerUrl ?? "").trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `ws://${raw.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return normalizeCardServerUrl(url.toString());
}

/**
 * Generation + target guard for async catalog responses: switching room or
 * connection, or a manual retry, invalidates every in-flight request so an old
 * response can never overwrite the display.
 */
export interface DuelCatalogSession {
  begin(serverUrl: string, stampKey: string): DuelCatalogRequest;
  isCurrent(request: DuelCatalogRequest): boolean;
  reset(): void;
}

export function createDuelCatalogSession(): DuelCatalogSession {
  let generation = 0;
  let current: DuelCatalogTarget | null = null;
  return {
    begin(serverUrl: string, stampKey: string): DuelCatalogRequest {
      generation += 1;
      current = { serverUrl, stampKey };
      return { generation, target: current };
    },
    isCurrent(request: DuelCatalogRequest): boolean {
      return current !== null &&
        request.generation === generation &&
        request.target.serverUrl === current.serverUrl &&
        request.target.stampKey === current.stampKey;
    },
    reset(): void {
      generation += 1;
      current = null;
    }
  };
}

/**
 * Loads the public catalog and accepts it only when its stamp equals the match
 * stamp. A mismatching catalog is reported as an error instead of being
 * displayed, and failures stay visible so the UI can offer a retry.
 */
export async function loadDuelCatalog(options: {
  client: CardCatalogClient;
  serverUrl: string;
  stampKey: string;
  timeoutMs?: number;
}): Promise<DuelCatalogLoadOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DUEL_CATALOG_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(DUEL_CATALOG_TIMEOUT_MESSAGE)),
        timeoutMs
      );
    });
    const catalog = await Promise.race([
      options.client.loadCatalog(options.serverUrl),
      timeout
    ]);
    if (catalogStampKey(catalog) !== options.stampKey) {
      return { status: "error", catalog: null, error: DUEL_CATALOG_STAMP_MISMATCH_MESSAGE };
    }
    return { status: "ready", catalog, error: null };
  } catch (error) {
    return {
      status: "error",
      catalog: null,
      error: messageFrom(error, DEFAULT_DUEL_CATALOG_ERROR)
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export interface UseDuelCardCatalogResult {
  readonly status: DuelCatalogStatus;
  readonly error: string | null;
  readonly serverUrl: string | null;
  readonly source: "reused" | "loaded" | null;
  readonly resolveCard: (cardId: string) => DuelCatalogCardView | null;
  readonly retry: () => void;
}

interface UseDuelCardCatalogOptions {
  /** Transport's active server URL (`GameClient.activeServerUrl`). */
  readonly activeServerUrl?: string | null;
  /** Stamp taken from the live `DuelProjection.match`; `null` outside a duel. */
  readonly stamp?: DuelCatalogStamp | null;
  /**
   * Already-loaded display catalog, reused only on an exact stamp match. Pass a
   * stable reference (loaded state), not a fresh object per render.
   */
  readonly reusableCatalog?: CardCatalog | null;
  readonly client?: CardCatalogClient;
  readonly timeoutMs?: number;
}

/** Internal state also remembers which endpoint + stamp produced it. */
interface DuelCatalogLoadState extends DuelCatalogState {
  readonly stampKey: string | null;
}

const IDLE_DUEL_CATALOG_STATE: DuelCatalogLoadState = {
  status: "idle",
  error: null,
  serverUrl: null,
  stampKey: null,
  catalog: null,
  source: null
};

export function useDuelCardCatalog(
  options: UseDuelCardCatalogOptions = {}
): UseDuelCardCatalogResult {
  const activeServerUrl = options.activeServerUrl ?? null;
  const stamp = options.stamp ?? null;
  const reusableCatalog = options.reusableCatalog ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DUEL_CATALOG_TIMEOUT_MS;
  const client = useMemo(
    () => options.client ?? new CardCatalogClient(),
    [options.client]
  );
  const session = useMemo(() => createDuelCatalogSession(), []);
  const [manualRetry, setManualRetry] = useState(0);
  const [state, setState] = useState<DuelCatalogLoadState>(IDLE_DUEL_CATALOG_STATE);

  const serverUrl = duelCatalogServerUrl(activeServerUrl);
  const stampKey = duelCatalogStampKey(stamp);
  const reused = reuseDuelCatalog(reusableCatalog, stamp);

  useEffect(() => {
    if (serverUrl === null || stampKey === null) {
      session.reset();
      setState(previous => (previous.status === "idle" ? previous : IDLE_DUEL_CATALOG_STATE));
      return;
    }
    if (reused !== null) {
      // A matching editor catalog is already displayed by the derived state
      // below; this only invalidates any pending fetch so a slower response
      // from a previous endpoint can no longer replace it.
      session.begin(serverUrl, stampKey);
      return;
    }

    const request = session.begin(serverUrl, stampKey);
    setState({ status: "loading", error: null, serverUrl, stampKey, catalog: null, source: null });
    void loadDuelCatalog({ client, serverUrl, stampKey, timeoutMs }).then(outcome => {
      if (!session.isCurrent(request)) return;
      setState({
        status: outcome.status,
        error: outcome.error,
        serverUrl,
        stampKey,
        catalog: outcome.catalog,
        source: outcome.status === "ready" ? "loaded" : null
      });
    });
  }, [client, manualRetry, reused, serverUrl, session, stampKey, timeoutMs]);

  // The displayed state is derived, not just the last effect result: a matching
  // editor catalog is reusable on the very render it becomes available (no
  // flash of raw printing ids), and any result that does not belong to the
  // current endpoint + stamp is discarded before it can be displayed.
  const active: DuelCatalogLoadState = useMemo(() => {
    if (stampKey === null) return IDLE_DUEL_CATALOG_STATE;
    if (serverUrl === null) {
      // A live duel whose connection endpoint is unknown cannot be silently
      // decoded into raw printing ids: that is a visible, retryable failure.
      return {
        status: "error",
        error: DUEL_CATALOG_ENDPOINT_MESSAGE,
        serverUrl: null,
        stampKey,
        catalog: null,
        source: null
      };
    }
    if (reused !== null) {
      return {
        status: "ready",
        error: null,
        serverUrl,
        stampKey,
        catalog: reused,
        source: "reused"
      };
    }
    if (state.serverUrl === serverUrl && state.stampKey === stampKey) return state;
    return {
      status: "loading",
      error: null,
      serverUrl,
      stampKey,
      catalog: null,
      source: null
    };
  }, [reused, serverUrl, stampKey, state]);

  const index = useMemo(() => {
    const catalog = active.catalog;
    if (catalog === null) return null;
    const byPrintingId = new Map<string, CatalogCard>();
    const byCanonicalId = new Map<string, CatalogCard>();
    for (const card of catalog.cards) {
      if (!byPrintingId.has(card.id)) byPrintingId.set(card.id, card);
      if (!byCanonicalId.has(card.canonicalCardId)) {
        byCanonicalId.set(card.canonicalCardId, card);
      }
    }
    return { byPrintingId, byCanonicalId };
  }, [active.catalog]);

  const imageBase = active.serverUrl;
  const resolveCard = useCallback(
    (cardId: string): DuelCatalogCardView | null => {
      if (index === null || !cardId) return null;
      const card =
        index.byPrintingId.get(cardId) ??
        index.byCanonicalId.get(cardId) ??
        null;
      if (card === null) return null;
      const title = [
        card.localizedName ?? card.name,
        card.localizedSubtitle ?? card.subtitle
      ]
        .filter(Boolean)
        .join(" · ");
      // The duel must show the images the *current* authoritative server
      // actually serves. Its own local `/api/card-images/<printingId>` route is
      // preferred over any catalog `imageUrl` (which is typically an external
      // CDN), so a live duel never depends on outbound internet access. The
      // remote URL is only a fallback for the impossible case of a ready index
      // with no resolvable endpoint.
      const localImageUrl = imageBase === null
        ? null
        : cardImageServerUrl(imageBase, card.id) || null;
      return {
        title,
        imageUrl: preferLocalCardImage(card.id, localImageUrl ?? card.imageUrl ?? null, card.imageUrl),
        domains: card.domains
      };
    },
    [imageBase, index]
  );

  const retry = useCallback(() => setManualRetry(token => token + 1), []);

  return {
    status: active.status,
    error: active.error,
    serverUrl: active.serverUrl,
    source: active.source,
    resolveCard,
    retry
  };
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
