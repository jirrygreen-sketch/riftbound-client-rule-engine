import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelProjection } from "@riftbound/protocol";
// These tests cover the legacy Duel route. RIFT-1125 made the V2 room UI the
// default, so pin the switch to the legacy route here.
vi.mock("../src/full-product/v2-ui-switch", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/full-product/v2-ui-switch")>()),
  readV2UiEnabled: () => false
}));

import {
  CardCatalogClient,
  type CardCatalog
} from "../src/net/CardCatalogClient";
import {
  DUEL_CATALOG_ENDPOINT_MESSAGE,
  DUEL_CATALOG_STAMP_MISMATCH_MESSAGE,
  DUEL_CATALOG_TIMEOUT_MESSAGE,
  catalogStampKey,
  createDuelCatalogSession,
  duelCatalogServerUrl,
  duelCatalogStampKey,
  loadDuelCatalog,
  reuseDuelCatalog,
  stampMatchesCatalog
} from "../src/hooks/useDuelCardCatalog";
import { App } from "../src/App";

// The live 1v1 duel names/images must come from a public catalog whose stamp
// equals the authoritative `DuelProjection.match` stamp. These tests cover the
// read-only seam the App hook uses: endpoint derivation, stamp matching/reuse,
// stamp rejection of a fetched catalog, and the generation guard that keeps an
// old endpoint's async response from ever reaching the display.

// The App wiring below renders the real App (and the real duel catalog hook)
// with only the transport and the deck-editor catalog substituted, so the
// "editor catalog must not label a live duel" rule is exercised end to end
// rather than asserted on an internal helper.
const route = vi.hoisted(() => ({
  duel: null as DuelProjection | null,
  editorCatalog: null as unknown,
  activeServerUrl: "ws://127.0.0.1:8794/ws" as string | null
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      actual.useState(
        initial === "home" ? "game-table" : initial
      )) as typeof actual.useState
  };
});

vi.mock("../src/hooks/useGameClient", () => ({
  readStoredSession: () => null,
  useGameClient: () => ({
    status: "connected",
    handshakeReady: true,
    commandPending: false,
    requestPending: false,
    projection: null,
    duelProjection: route.duel,
    lastError: null,
    errorRevision: 0,
    roomId: "room-1",
    roomView: null,
    gameEvents: [],
    session: { roomId: "room-1", playerId: "p1", resumeToken: "private" },
    storedSession: null,
    activeServerUrl: route.activeServerUrl,
    connect() {},
    createRoom() {},
    joinRoom() {},
    submitDeck() { return null; },
    setReady() { return null; },
    roomRequestReceipt: null,
    roomRequestFailure: null,
    syncEvents() {},
    pass() {},
    playCard() {},
    submitPlayerCommand() {},
    submitDuelCommand() {},
    concede() {},
    respondPrompt() {},
    clearError() {}
  })
}));

vi.mock("../src/hooks/useCardCatalog", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/hooks/useCardCatalog")>();
  return {
    ...actual,
    useCardCatalog: () => ({
      catalog: route.editorCatalog,
      catalogStatus: route.editorCatalog === null ? "error" : "ready",
      catalogError: null,
      deck: actual.emptyDeckByZone(),
      setZoneFromEntries() {},
      setDeckFromSnapshot() {},
      validation: null,
      validationStatus: "idle",
      validationError: null,
      validateDeck: async () => {},
      retryCatalog() {}
    })
  };
});

const duelFixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjection>>;

function editorCatalogWith(name: string, dataVersion: string, digest: string): CardCatalog {
  const value = catalogJson(dataVersion, digest) as {
    cards: Record<string, unknown>[];
  };
  // `card.0.1` is the printing id the setup fixture's viewer hand references.
  Object.assign(value.cards[0], {
    id: "card.0.1",
    canonicalCardId: "card.0.1",
    name,
    fullName: name,
    imageUrl: `https://images.example/${name}.png`
  });
  return value as CardCatalog;
}

function catalogJson(dataVersion: string, digest: string): unknown {
  return {
    schemaVersion: 1,
    dataVersion,
    digest,
    cards: [
      {
        id: "OGN-001",
        canonicalCardId: "canonical-1",
        name: "真实馆藏名称",
        fullName: "真实馆藏名称",
        cardType: "unit",
        domains: ["Fury"],
        tags: [],
        setCode: "OGN",
        cardNumber: "001",
        variant: "standard",
        imageUrl: null,
        energy: 1,
        power: 0,
        might: 1,
        ability: ""
      }
    ]
  };
}

function catalog(dataVersion: string, digest: string): CardCatalog {
  return catalogJson(dataVersion, digest) as CardCatalog;
}

function stubClient(load: () => Promise<CardCatalog>): CardCatalogClient {
  return { loadCatalog: vi.fn(load) } as unknown as CardCatalogClient;
}

describe("duelCatalogServerUrl", () => {
  it("maps the active WebSocket target onto the public catalog endpoint", () => {
    // Root's live setup: the game WS and the compiled server share 8794.
    expect(duelCatalogServerUrl("ws://127.0.0.1:8794/ws")).toBe("http://127.0.0.1:8794");
    expect(duelCatalogServerUrl("ws://127.0.0.1:8794")).toBe("http://127.0.0.1:8794");
    expect(duelCatalogServerUrl("wss://cards.example:443/ws")).toBe("https://cards.example");
  });

  it("keeps an already-HTTP address and accepts a bare host", () => {
    expect(duelCatalogServerUrl("http://127.0.0.1:8793")).toBe("http://127.0.0.1:8793");
    expect(duelCatalogServerUrl("127.0.0.1:8794")).toBe("http://127.0.0.1:8794");
  });

  it("returns nothing when no usable endpoint is known", () => {
    expect(duelCatalogServerUrl(null)).toBeNull();
    expect(duelCatalogServerUrl(undefined)).toBeNull();
    expect(duelCatalogServerUrl("   ")).toBeNull();
    expect(duelCatalogServerUrl("ftp://127.0.0.1:8794")).toBeNull();
  });
});

describe("duel catalog stamp matching", () => {
  const stamp = { dataVersion: "data-1", catalogDigest: "digest-1" };

  it("reuses only an already-loaded catalog with the exact match stamp", () => {
    const loaded = catalog("data-1", "digest-1");
    expect(stampMatchesCatalog(loaded, stamp)).toBe(true);
    expect(reuseDuelCatalog(loaded, stamp)).toBe(loaded);
  });

  it("refuses a different or older loaded catalog", () => {
    expect(reuseDuelCatalog(catalog("data-2", "digest-1"), stamp)).toBeNull();
    expect(reuseDuelCatalog(catalog("data-1", "digest-2"), stamp)).toBeNull();
    expect(reuseDuelCatalog(catalog("data-0", "digest-0"), stamp)).toBeNull();
  });

  it("has no stamp outside a duel or with an empty/invalid stamp", () => {
    expect(stampMatchesCatalog(catalog("data-1", "digest-1"), null)).toBe(false);
    expect(reuseDuelCatalog(null, stamp)).toBeNull();
    expect(duelCatalogStampKey(null)).toBeNull();
    expect(duelCatalogStampKey({ dataVersion: "  ", catalogDigest: "digest-1" })).toBeNull();
    expect(duelCatalogStampKey({ dataVersion: "data-1", catalogDigest: "" })).toBeNull();
    expect(duelCatalogStampKey(stamp)).toBe(
      catalogStampKey(catalog("data-1", "digest-1"))
    );
  });
});

describe("loadDuelCatalog", () => {
  const stamp = { dataVersion: "data-1", catalogDigest: "digest-1" };

  it("accepts a public catalog whose stamp matches the live match", async () => {
    const outcome = await loadDuelCatalog({
      client: stubClient(async () => catalog("data-1", "digest-1")),
      serverUrl: "http://127.0.0.1:8794",
      stampKey: duelCatalogStampKey(stamp)!
    });
    expect(outcome.status).toBe("ready");
    expect(outcome.error).toBeNull();
    expect(outcome.catalog?.cards).toHaveLength(1);
  });

  it("never surfaces a fetched catalog from a different stamp", async () => {
    const outcome = await loadDuelCatalog({
      client: stubClient(async () => catalog("data-1", "digest-old")),
      serverUrl: "http://127.0.0.1:8794",
      stampKey: duelCatalogStampKey(stamp)!
    });
    expect(outcome.status).toBe("error");
    expect(outcome.catalog).toBeNull();
    expect(outcome.error).toBe(DUEL_CATALOG_STAMP_MISMATCH_MESSAGE);
  });

  it("reports a failure instead of a bare board", async () => {
    const outcome = await loadDuelCatalog({
      client: stubClient(async () => {
        throw new Error("无法连接仓库服务。");
      }),
      serverUrl: "http://127.0.0.1:8794/ws",
      stampKey: duelCatalogStampKey(stamp)!
    });
    expect(outcome).toEqual({
      status: "error",
      catalog: null,
      error: "无法连接仓库服务。"
    });
  });

  it("times out a hanging endpoint with a retryable message", async () => {
    const outcome = await loadDuelCatalog({
      client: stubClient(() => new Promise<CardCatalog>(() => {})),
      serverUrl: "http://127.0.0.1:8794",
      stampKey: duelCatalogStampKey(stamp)!,
      timeoutMs: 5
    });
    expect(outcome.status).toBe("error");
    expect(outcome.catalog).toBeNull();
    expect(outcome.error).toBe(DUEL_CATALOG_TIMEOUT_MESSAGE);
  });

  it("loads through the real client normalizer from the ws-derived endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(catalogJson("data-1", "digest-1")), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const endpoint = duelCatalogServerUrl("ws://127.0.0.1:8794/ws");
    const outcome = await loadDuelCatalog({
      client: new CardCatalogClient({ fetchImpl, retryDelaysMs: [] }),
      serverUrl: endpoint!,
      stampKey: duelCatalogStampKey(stamp)!
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8794/api/cards", undefined);
    expect(outcome.status).toBe("ready");
  });
});

describe("duel catalog request generation", () => {
  it("drops an old endpoint's response after the room/connection switched", () => {
    const session = createDuelCatalogSession();
    const first = session.begin("http://127.0.0.1:8794", "stamp-a");
    expect(session.isCurrent(first)).toBe(true);

    const second = session.begin("http://127.0.0.1:8794", "stamp-b");
    expect(session.isCurrent(first)).toBe(false);
    expect(session.isCurrent(second)).toBe(true);

    const otherEndpoint = session.begin("http://127.0.0.1:8795", "stamp-b");
    expect(session.isCurrent(second)).toBe(false);
    expect(session.isCurrent(otherEndpoint)).toBe(true);
  });

  it("drops a failed attempt after retry and after leaving the duel", () => {
    const session = createDuelCatalogSession();
    const failed = session.begin("http://127.0.0.1:8794", "stamp-a");
    const retried = session.begin("http://127.0.0.1:8794", "stamp-a");
    expect(session.isCurrent(failed)).toBe(false);
    expect(session.isCurrent(retried)).toBe(true);

    session.reset();
    expect(session.isCurrent(retried)).toBe(false);
  });
});

describe("App live-duel card catalog wiring", () => {
  beforeEach(() => {
    // The real setup fixture carries dataVersion "data-1" / catalogDigest
    // "digest-1"; the viewer is p1 and holds card.0.1.
    route.duel = duelFixtures.setup?.p1 ?? null;
    route.editorCatalog = null;
    route.activeServerUrl = "ws://127.0.0.1:8794/ws";
  });

  it("reuses an already-loaded editor catalog when its stamp matches the live match", () => {
    route.editorCatalog = editorCatalogWith("匹配馆藏名称", "data-1", "digest-1");
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("匹配馆藏名称");
    // The current server's own card-image route wins even though this catalog
    // card also carries a remote CDN imageUrl: a live duel must not depend on
    // outbound internet access to render.
    expect(html).toContain("http://127.0.0.1:8794/api/card-images/card.0.1");
    expect(html).not.toContain("https://images.example/匹配馆藏名称.png");
    expect(html).not.toContain("正在从当前对局服务加载卡牌名称与图片");
  });

  it("keeps a differently-stamped editor catalog out of the duel and shows the load state", () => {
    route.editorCatalog = editorCatalogWith("旧版本馆藏名称", "data-1", "digest-old");
    const html = renderToStaticMarkup(createElement(App));
    expect(html).not.toContain("旧版本馆藏名称");
    expect(html).not.toContain("https://images.example/旧版本馆藏名称.png");
    expect(html).toContain("正在从当前对局服务加载卡牌名称与图片");
  });

  it("reports a live duel with no resolvable endpoint instead of showing bare ids", () => {
    route.activeServerUrl = null;
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain(DUEL_CATALOG_ENDPOINT_MESSAGE);
    expect(html).toContain('role="alert"');
  });

  it("shows no catalog notice outside a duel", () => {
    route.duel = null;
    const html = renderToStaticMarkup(createElement(App));
    expect(html).not.toContain(DUEL_CATALOG_ENDPOINT_MESSAGE);
    expect(html).not.toContain("正在从当前对局服务加载卡牌名称与图片");
  });
});
