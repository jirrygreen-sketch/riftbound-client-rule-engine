import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelProjectionV3Actions1,
  type DuelProjectionV3Actions1
} from "@riftbound/protocol";
import type { CardCatalog } from "../src/net/CardCatalogClient";
// These tests cover the legacy Duel route. RIFT-1125 made the V2 room UI the
// default, so pin the switch to the legacy route here.
vi.mock("../src/full-product/v2-ui-switch", async importOriginal => ({
  ...(await importOriginal<typeof import("../src/full-product/v2-ui-switch")>()),
  readV2UiEnabled: () => false
}));


/*
 * App-level wiring for the per-Legend resource counters.
 *
 * The board's base band already renders "energy + this seat's two Legend
 * domains + universal power" and the component-level contract is covered by
 * `full-product/DuelBaseRibbonVisibility.test.tsx`. What was untested is the
 * real seam: `App` resolves a Legend's domains through the real
 * `useDuelCardCatalog` hook (stamp-matched public catalog), and that resolved
 * function is what the live board and the read-only replay board receive.
 *
 * Every projection here is a genuine P4 DTO asserted with the production
 * `isDuelProjectionV3Actions1` guard and built from wire shapes only: the wire
 * carries NO Legend domain, so each displayed domain can only come from the
 * stamp-matched catalog. A JSDOM-free `renderToStaticMarkup` pass proves
 * structure only; it is not a recorded match and sends no command.
 */

const route = vi.hoisted(() => ({
  tab: "game-table" as string,
  seedReplaySelection: false,
  pendingReplaySelection: false,
  replaySelection: { id: "rec-legend", index: 0 },
  duel: null as unknown,
  editorCatalog: null as unknown,
  activeServerUrl: "ws://127.0.0.1:8794/ws" as string | null
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  return {
    ...actual,
    useState: ((initial: unknown) => {
      // The App starts on `home`; SSR cannot navigate, so the initial route is
      // substituted. When a replay is under test, the replay cursor that
      // immediately follows the (lazy) replay-library initializer is seeded too.
      if (initial === "home") return actual.useState(route.tab);
      if (typeof initial === "function") {
        const probe = (initial as () => unknown)();
        if (route.seedReplaySelection && isRecord(probe) && Array.isArray(probe.recordings)) {
          route.pendingReplaySelection = true;
        }
        return actual.useState(probe as never);
      }
      if (initial === null && route.pendingReplaySelection) {
        route.pendingReplaySelection = false;
        return actual.useState(route.replaySelection);
      }
      return actual.useState(initial as never);
    }) as typeof actual.useState
  };
});

vi.mock("../src/hooks/useGameClient", () => ({
  readStoredSession: () => null,
  useGameClient: () => ({
    status: "connected",
    handshakeReady: true,
    commandPending: false,
    requestPending: false,
    chatMessages: [],
    chatPending: false,
    chatError: null,
    sendChat() { return null; },
    disconnect() {},
    projection: null,
    duelProjection: route.duel,
    lastError: null,
    errorRevision: 0,
    roomId: "room-1",
    roomView: null,
    ownerDeckConfirmation: null,
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
    submitDuelCommandPacket() { return false; },
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

import { App } from "../src/App";

const store = new Map<string, string>();
const storage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => { store.set(key, value); },
  removeItem: (key: string): void => { store.delete(key); }
};

/** Independent expectations for the game's six domains; not read off the board. */
const FURY = "炽烈";
const CALM = "翠意";
const MIND = "灵光";
const BODY = "摧破";
const CHAOS = "混沌";
const ORDER = "序理";
const ENERGY_LABEL = "能量：";
const ANY_LABEL = "通用符能：";
const powerLabel = (domain: string): string => `${domain}符能：`;

const EMPTY_POWER = { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } as const;

interface BuildOptions {
  readonly viewer: string | null;
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly dataVersion?: string;
  readonly catalogDigest?: string;
}

/**
 * A real playing P4 board for the two seats `alice` / `bob`, with distinct
 * per-seat pools and base runes whose domains deliberately differ from the
 * Legend domains supplied only via the catalog. The viewer's own hand is the
 * only hand array present (every other seat has a public count only), so a
 * hidden-hand leak is an exact, checkable claim.
 */
function playingBoard(options: BuildOptions): DuelProjectionV3Actions1 {
  const viewer = options.viewer;
  const BASE_A = JSON.stringify(["duel-base", "alice"]);
  const BASE_B = JSON.stringify(["duel-base", "bob"]);
  const FIELD_A = JSON.stringify(["duel-battlefield", "bf-a"]);
  const FIELD_B = JSON.stringify(["duel-battlefield", "bf-b"]);

  const rune = (uid: string, cardId: string, domain: string, readied: boolean): Record<string, unknown> => ({
    uid, cardId, domain, readied, ownerPlayerId: "alice", controllerPlayerId: "alice", locationId: BASE_A
  });

  const alice: Record<string, unknown> = {
    playerId: "alice",
    champion: null,
    legend: { cardId: "legend.0", controllerPlayerId: "alice", readiness: "ready" },
    handCount: 2,
    mainDeckCount: 12,
    trash: []
  };
  const bob: Record<string, unknown> = {
    playerId: "bob",
    champion: null,
    legend: { cardId: "legend.1", controllerPlayerId: "bob", readiness: "ready" },
    handCount: 2,
    mainDeckCount: 11,
    trash: []
  };
  if (viewer === "alice") {
    alice.hand = [
      { uid: "alice-hand-1", cardId: "hand-alice-1" },
      { uid: "alice-hand-2", cardId: "hand-alice-2" }
    ];
  }
  if (viewer === "bob") {
    bob.hand = [
      { uid: "bob-hand-1", cardId: "hand-bob-1" },
      { uid: "bob-hand-2", cardId: "hand-bob-2" }
    ];
  }

  const projection = {
    projectionSchema: DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
    viewerPlayerId: viewer,
    match: {
      schemaVersion: 3,
      rulesetId: "riftbound-duel",
      matchId: "match-legend-1",
      dataVersion: options.dataVersion ?? "data-1",
      catalogDigest: options.catalogDigest ?? "digest-1",
      stateVersion: options.stateVersion ?? 6,
      eventSeq: options.eventSeq ?? 6,
      roster: [
        { playerId: "alice", displayName: "Alice" },
        { playerId: "bob", displayName: "Bob" }
      ],
      turnOrder: ["alice", "bob"],
      stage: "playing",
      players: [alice, bob],
      board: {
        bases: [
          { locationId: BASE_A, ownerPlayerId: "alice", occupancy: [] },
          { locationId: BASE_B, ownerPlayerId: "bob", occupancy: [] }
        ],
        battlefields: [
          {
            locationId: FIELD_A, instanceId: "bf-a", cardId: "field-card-a",
            ownerPlayerId: "alice", controllerPlayerId: null, contested: false,
            contestingPlayerId: null, showdown: "none", combat: "none", occupancy: []
          },
          {
            locationId: FIELD_B, instanceId: "bf-b", cardId: "field-card-b",
            ownerPlayerId: "bob", controllerPlayerId: null, contested: false,
            contestingPlayerId: null, showdown: "none", combat: "none", occupancy: []
          }
        ],
        units: [],
        gears: []
      },
      resources: {
        players: [
          {
            playerId: "alice",
            runePool: {
              energy: 5,
              power: { Fury: 4, Calm: 1, Mind: 2, Body: 3, Chaos: 7, Order: 6, any: 8 }
            },
            runeDeckCount: 8
          },
          {
            playerId: "bob",
            runePool: {
              energy: 9,
              power: { Fury: 1, Calm: 2, Mind: 3, Body: 4, Chaos: 5, Order: 6, any: 7 }
            },
            runeDeckCount: 9
          }
        ],
        bases: [
          {
            playerId: "alice",
            locationId: BASE_A,
            // Nonzero, non-Legend rune domains prove the counters are not
            // guessed from the rune row or a nonzero power pool.
            baseRunes: [rune("alice-rune-1", "rune-a", "Order", true), rune("alice-rune-2", "rune-b", "Calm", false)],
            goldTokens: []
          },
          { playerId: "bob", locationId: BASE_B, baseRunes: [], goldTokens: [] }
        ]
      },
      scoring: {
        playerIds: ["alice", "bob"],
        battlefieldLocationIds: [FIELD_A, FIELD_B],
        victoryScore: 8,
        turnNumber: 3,
        players: [
          { playerId: "alice", points: 0, scoredBattlefieldLocationIds: [] },
          { playerId: "bob", points: 0, scoredBattlefieldLocationIds: [] }
        ]
      },
      frame: {
        phase: "main",
        turnNumber: 3,
        turnPlayerId: "alice",
        priorityPlayerId: "alice",
        focusPlayerId: null,
        stateOpen: true,
        pendingPayment: null,
        chain: { active: false },
        pendingChoice: null,
        execution: { status: "ready" }
      }
    },
    actions: []
  } as unknown as DuelProjectionV3Actions1;

  expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  return projection;
}

function catalogCard(id: string, domains: readonly string[]): Record<string, unknown> {
  return {
    id,
    canonicalCardId: id,
    name: `卡 ${id}`,
    fullName: `卡 ${id}`,
    cardType: "legend",
    domains,
    tags: [],
    setCode: "OGN",
    cardNumber: "001",
    variant: "standard",
    imageUrl: null,
    energy: null,
    power: null,
    might: null,
    ability: ""
  };
}

function catalogWith(
  cards: readonly Record<string, unknown>[],
  dataVersion = "data-1",
  digest = "digest-1"
): CardCatalog {
  return { schemaVersion: 1, dataVersion, digest, cards } as unknown as CardCatalog;
}

/** Catalog whose Legend printings carry the two domains each seat must show. */
function legendCatalog(digest = "digest-1", legendIds: readonly string[] = ["legend.0", "legend.1"]): CardCatalog {
  const domains: Record<string, readonly string[]> = {
    "legend.0": ["Fury", "Mind"],
    "legend.1": ["Body", "Chaos"]
  };
  return catalogWith(
    legendIds.map(id => catalogCard(id, domains[id] ?? ["Fury"])),
    "data-1",
    digest
  );
}

function renderApp(): string {
  return renderToStaticMarkup(createElement(App));
}

/** The `能量/符能/通用符能` counter list for one named seat, or null if absent. */
function poolEntries(html: string, name: string): readonly { readonly dt: string; readonly dd: string }[] | null {
  const marker = `aria-label="${name} 当前资源池"`;
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf("</dl>", start);
  expect(end, `${name} counter list not closed`).toBeGreaterThan(start);
  const dl = html.slice(start, end);
  return [...dl.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map(match => ({
    dt: match[1] ?? "",
    dd: match[2] ?? ""
  }));
}

function poolValues(html: string, name: string): Record<string, string> {
  const entries = poolEntries(html, name);
  expect(entries, `${name} counter list`).not.toBeNull();
  return Object.fromEntries(entries!.map(entry => [entry.dt, entry.dd]));
}

function poolLabels(html: string, name: string): string[] {
  return (poolEntries(html, name) ?? []).map(entry => entry.dt).sort();
}

function replayLibraryJson(frames: readonly unknown[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    recordings: [{
      id: "rec-legend",
      roomId: "room-1",
      title: "Alice vs Bob",
      savedAt: "2026-10-15T00:00:00.000Z",
      frames
    }]
  });
}

beforeEach(() => {
  store.clear();
  route.tab = "game-table";
  route.seedReplaySelection = false;
  route.pendingReplaySelection = false;
  route.duel = null;
  route.editorCatalog = null;
  route.activeServerUrl = "ws://127.0.0.1:8794/ws";
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App live-duel per-Legend counters via the catalog hook", () => {
  it("shows each seat's two Legend domains with numbers from that seat's pool only", () => {
    route.duel = playingBoard({ viewer: "alice" });
    route.editorCatalog = legendCatalog();

    const html = renderApp();

    // Roster names drive the seat labels.
    expect(html).toContain("Alice 基地");
    expect(html).toContain("Bob 基地");

    // Alice's Legend (Fury/Mind) but with Alice's own pool numbers.
    expect(poolLabels(html, "Alice")).toEqual([ENERGY_LABEL, powerLabel(FURY), powerLabel(MIND), ANY_LABEL].sort());
    expect(poolValues(html, "Alice")).toEqual({
      [ENERGY_LABEL]: "5",
      [powerLabel(FURY)]: "4",
      [powerLabel(MIND)]: "2",
      [ANY_LABEL]: "8"
    });

    // Bob's distinct Legend (Body/Chaos), and Bob's distinct pool numbers: if the
    // board reused Alice's pool, Bob's Body/Chaos/energy would be 3/7/5 instead.
    expect(poolLabels(html, "Bob")).toEqual([ENERGY_LABEL, powerLabel(BODY), powerLabel(CHAOS), ANY_LABEL].sort());
    expect(poolValues(html, "Bob")).toEqual({
      [ENERGY_LABEL]: "9",
      [powerLabel(BODY)]: "4",
      [powerLabel(CHAOS)]: "5",
      [ANY_LABEL]: "7"
    });

    // Neither counter list shows the other four domains, even though the rune
    // row carries nonzero Order/Calm and both pools hold nonzero values for all
    // six domains.
    const aliceDl = JSON.stringify(poolEntries(html, "Alice"));
    expect(aliceDl).not.toContain(CALM);
    expect(aliceDl).not.toContain(BODY);
    expect(aliceDl).not.toContain(CHAOS);
    expect(aliceDl).not.toContain(ORDER);
    const bobDl = JSON.stringify(poolEntries(html, "Bob"));
    expect(bobDl).not.toContain(FURY);
    expect(bobDl).not.toContain(CALM);
    expect(bobDl).not.toContain(MIND);
    expect(bobDl).not.toContain(ORDER);
  });

  it("keeps the viewer's own hand and never the other seat's, when the viewer swaps", () => {
    route.editorCatalog = legendCatalog();

    route.duel = playingBoard({ viewer: "alice" });
    const asAlice = renderApp();
    expect(asAlice).toContain('data-uid="alice-hand-1"');
    expect(asAlice).not.toContain('data-uid="bob-hand-1"');
    // Alice is the bottom seat, Bob the opponent.
    expect(asAlice).toContain('data-position="player" data-owner-player-id="alice"');
    expect(asAlice).toContain('data-position="opponent" data-owner-player-id="bob"');

    route.duel = playingBoard({ viewer: "bob" });
    const asBob = renderApp();
    expect(asBob).toContain('data-uid="bob-hand-1"');
    expect(asBob).not.toContain('data-uid="alice-hand-1"');
    expect(asBob).toContain('data-position="player" data-owner-player-id="bob"');
    expect(asBob).toContain('data-position="opponent" data-owner-player-id="alice"');
    // Bob still sees Alice's Legend domains and Alice's own pool numbers.
    expect(poolValues(asBob, "Alice")).toEqual({
      [ENERGY_LABEL]: "5",
      [powerLabel(FURY)]: "4",
      [powerLabel(MIND)]: "2",
      [ANY_LABEL]: "8"
    });
  });

  it("shows both public counter lists to a spectator without any viewer hand", () => {
    route.duel = playingBoard({ viewer: null });
    route.editorCatalog = legendCatalog();

    const html = renderApp();
    expect(poolValues(html, "Alice")[ENERGY_LABEL]).toBe("5");
    expect(poolValues(html, "Bob")[ENERGY_LABEL]).toBe("9");
    // A spectator gets the public hidden-hand summary for both seats and no
    // viewer hand card at all.
    expect(html).toContain("牌面隐藏");
    expect(html).not.toContain('data-uid="alice-hand-1"');
    expect(html).not.toContain('data-uid="bob-hand-1"');
  });
});

describe("App catalog stamp gate for Legend domains", () => {
  it("shows only energy + universal power while a mismatched editor catalog is loading", () => {
    route.duel = playingBoard({ viewer: "alice" });
    // Same data version, different digest: the stamp does not match the duel.
    route.editorCatalog = legendCatalog("digest-old");

    const html = renderApp();
    expect(html).toContain('aria-label="对局卡牌目录"');
    expect(html).toContain('role="status"');

    for (const name of ["Alice", "Bob"]) {
      expect(poolLabels(html, name)).toEqual([ENERGY_LABEL, ANY_LABEL].sort());
    }
    expect(html).not.toContain(FURY);
    expect(html).not.toContain(MIND);
    expect(html).not.toContain(BODY);
    expect(html).not.toContain(CHAOS);
  });

  it("never derives a Legend domain from the rune row when the matched catalog omits the Legend", () => {
    route.duel = playingBoard({ viewer: "alice" });
    // Exact stamp match, but only Alice's legend printing is present.
    route.editorCatalog = legendCatalog("digest-1", ["legend.0"]);

    const html = renderApp();
    expect(poolLabels(html, "Alice")).toEqual([ENERGY_LABEL, powerLabel(FURY), powerLabel(MIND), ANY_LABEL].sort());
    // Bob's Legend is absent, so Bob falls back to energy + universal power only
    // even though his base runes and pool carry other domains.
    expect(poolLabels(html, "Bob")).toEqual([ENERGY_LABEL, ANY_LABEL].sort());
    expect(JSON.stringify(poolEntries(html, "Bob"))).not.toContain(BODY);
    expect(JSON.stringify(poolEntries(html, "Bob"))).not.toContain(CHAOS);
  });

  it("refuses every Legend domain when no usable catalog endpoint is known", () => {
    route.duel = playingBoard({ viewer: "alice" });
    route.editorCatalog = legendCatalog();
    route.activeServerUrl = null;

    const html = renderApp();
    expect(html).toContain('aria-label="对局卡牌目录"');
    expect(html).toContain('role="alert"');
    for (const name of ["Alice", "Bob"]) {
      expect(poolLabels(html, name)).toEqual([ENERGY_LABEL, ANY_LABEL].sort());
    }
  });
});

describe("App replay board uses the replay frame's own stamp", () => {
  it("labels a read-only replay from its own stamp and disables commands", () => {
    const frame = playingBoard({ viewer: "alice", stateVersion: 6, eventSeq: 6 });
    const later = playingBoard({ viewer: "alice", stateVersion: 7, eventSeq: 7 });
    store.set("riftbound.desktop-client.replay-library.v1", replayLibraryJson([frame, later]));
    route.tab = "replays";
    route.seedReplaySelection = true;
    route.editorCatalog = legendCatalog();

    const html = renderApp();
    expect(html).toContain('aria-label="对局回放"');
    expect(html).toContain('aria-label="回放牌桌"');
    expect(html).toContain("回放视角");
    expect(html).not.toContain('class="full-product-duel-action"');
    expect(poolValues(html, "Alice")).toEqual({
      [ENERGY_LABEL]: "5",
      [powerLabel(FURY)]: "4",
      [powerLabel(MIND)]: "2",
      [ANY_LABEL]: "8"
    });
    expect(poolValues(html, "Bob")).toEqual({
      [ENERGY_LABEL]: "9",
      [powerLabel(BODY)]: "4",
      [powerLabel(CHAOS)]: "5",
      [ANY_LABEL]: "7"
    });
    // The replay frame is an alice-view frame, so it carries alice's own hand and
    // never bob's; gameplay commands stay closed.
    expect(html).toContain('data-uid="alice-hand-1"');
    expect(html).not.toContain('data-uid="bob-hand-1"');
  });

  it("does not relabel a replay whose frame stamp differs from the loaded catalog", () => {
    const frame = playingBoard({ viewer: "alice", dataVersion: "dv-old", catalogDigest: "cd-old" });
    store.set("riftbound.desktop-client.replay-library.v1", replayLibraryJson([frame]));
    route.tab = "replays";
    route.seedReplaySelection = true;
    route.editorCatalog = legendCatalog();

    const html = renderApp();
    expect(html).toContain('aria-label="对局回放"');
    for (const name of ["Alice", "Bob"]) {
      expect(poolLabels(html, name)).toEqual([ENERGY_LABEL, ANY_LABEL].sort());
    }
    expect(html).not.toContain(BODY);
    expect(html).not.toContain(CHAOS);
  });
});
