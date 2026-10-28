import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { buildCardNameIndex, resolveCardName } from "../../src/full-product/v2/card-names";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type {
  V2ChoiceOption,
  V2PendingChoice,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";

const RUMBLE_CANONICAL = "card.hash-rumble";
const RUMBLE_PRINTING = "sfd-026-221";
const FIELD_CANONICAL = "card.hash-treasure-hoard";
const FIELD_PRINTING = "sfd-220-221";
const RUNE_CANONICAL = "card.hash-fury-rune";
const RUNE_PRINTING = "ogn-007-298";
const LEGEND_CANONICAL = "card.hash-relentless-storm";
const CHAMPION_CANONICAL = "card.hash-fiora";

function withCardType(card: CatalogCard, cardType: string): CatalogCard {
  return { ...card, cardType };
}

function catalogCard(name: string, localizedName: string | undefined, id: string, canonicalCardId: string): CatalogCard {
  return {
    id,
    canonicalCardId,
    name,
    fullName: name,
    ...(localizedName === undefined ? {} : { localizedName }),
    cardType: "Unit",
    domains: ["Fury"],
    tags: [],
    setCode: id.slice(0, 3),
    cardNumber: id,
    variant: "standard",
    imageUrl: null,
    energy: 2,
    power: 1,
    might: 3,
    ability: "",
  };
}

const catalog: readonly CatalogCard[] = [
  catalogCard("Rumble", "兰博", RUMBLE_PRINTING, RUMBLE_CANONICAL),
  catalogCard("Rumble", "兰博", "sfd-026a-221", RUMBLE_CANONICAL),
  catalogCard("Treasure Hoard", "珍宝堆", FIELD_PRINTING, FIELD_CANONICAL),
  catalogCard("Fury Rune", "炽烈符文", RUNE_PRINTING, RUNE_CANONICAL),
  withCardType(catalogCard("Relentless Storm", "不灭狂雷", "ogn-249-298", LEGEND_CANONICAL), "Legend"),
  withCardType(catalogCard("Fiora", "菲奥娜", "ogn-232-298", CHAMPION_CANONICAL), "Champion"),
  catalogCard("No Localization", undefined, "ogn-fallback", "card.hash-fallback"),
];

function object(
  objectId: string,
  cardId: string,
  name: string,
  zone: V2ProjectedObject["zone"],
  location?: V2ProjectedObject["location"],
): V2ProjectedObject {
  return {
    objectId,
    zoneEntryId: 1,
    zone,
    ownerPlayerId: "alice",
    ...(zone === "board" || zone === "base" || zone === "battlefield" ? { controllerPlayerId: "alice" } : {}),
    cardId,
    name,
    faceDown: false,
    visibility: "owner-only",
    ...(location === undefined ? {} : { location }),
  };
}

function projection(overrides: Partial<V2Projection> = {}): V2Projection {
  const rumble = object("unit-1", RUMBLE_CANONICAL, "Rumble", "board",
    { kind: "base", playerId: "alice" });
  const battlefield = object("field-1", FIELD_CANONICAL, "Treasure Hoard", "board");
  const rune = object("rune-1", RUNE_CANONICAL, "Fury Rune", "rune-zone");
  const legend = object("legend-1", LEGEND_CANONICAL, "Relentless Storm", "legend");
  const champion = object("champion-1", CHAMPION_CANONICAL, "Fiora", "champion");
  const fallback = object("fallback-1", "card.hash-fallback", "No Localization", "board",
    { kind: "base", playerId: "alice" });
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-1123",
    viewerPlayerId: "alice",
    stateVersion: 9,
    eventSeq: 8,
    phase: "main",
    turnNumber: 3,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 1, energy: 2, power: {}, xp: 0, handCount: 1, deckCount: 20, runeDeckCount: 8, zoneCounts: { "rune-zone": 1 } },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 4, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "alice", count: 1, objects: [
        { ...rumble, objectId: "hand-1", zone: "hand", controllerPlayerId: undefined, location: undefined },
      ] },
      { zone: "hand", ownerPlayerId: "bob", count: 4 },
      { zone: "rune-zone", ownerPlayerId: "alice", count: 1, objects: [rune] },
      { zone: "legend", ownerPlayerId: "alice", count: 1, objects: [legend] },
      { zone: "champion", ownerPlayerId: "alice", count: 1, objects: [champion] },
    ],
    objects: [
      { ...rumble, objectId: "hand-1", zone: "hand", controllerPlayerId: undefined, location: undefined },
      rumble,
      fallback,
      battlefield,
      rune,
      legend,
      champion,
    ],
    chain: { status: "open", phase: "open", priorityPlayerId: "alice", focusPlayerId: null,
      items: [{ itemId: "chain-1", controllerPlayerId: "alice", status: "pending", kind: "spell",
        sourceObjectId: "hand-1", sourceVisibility: "owner-only" }] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "alice", points: 1, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "alice", contestedByPlayerId: null,
      staged: "none", occupantObjectIds: [] }],
    combat: { status: "none" },
    actionOptions: {
      canEndTurn: true,
      canAdvance: false,
      moves: [
        { objectId: "unit-1", destination: { kind: "battlefield", battlefieldId: "field-1" } },
      ],
      plays: [
        { cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" }, requiresDestination: true },
        { cardObjectId: "hand-1", destination: { kind: "battlefield", battlefieldId: "field-1" }, requiresDestination: true },
      ],
    },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [{
      contract: "riftbound.protocol.v2.event", seq: 8, eventSeq: 8, stateVersion: 9,
      timingPoint: "card-played", audience: { visibility: "public" },
      payload: {
        objectId: { visibility: "public", value: "unit-1" },
        cardId: { visibility: "public", value: RUMBLE_CANONICAL },
        battlefieldId: { visibility: "public", value: "field-1" },
        note: { visibility: "public", value: "ordinary text" },
      },
    }],
    ...overrides,
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 }),
  };
}

function render(value: V2Projection, cards?: readonly CatalogCard[]): string {
  return renderToStaticMarkup(<V2MatchBoard
    state={state(value)}
    initialCatalogCards={cards}
    initialSelectedCardId="hand-1"
    onCommand={vi.fn()}
  />);
}

function panel(markup: string, ariaLabel: string): string {
  const start = markup.indexOf(`aria-label="${ariaLabel}"`);
  expect(start, ariaLabel).toBeGreaterThan(-1);
  const end = markup.indexOf("</section>", start);
  return markup.slice(start, end === -1 ? undefined : end);
}

describe("RIFT-1123 V2 official Chinese card names", () => {
  it("indexes printing, canonical, and unambiguous English identities without translating missing names", () => {
    const index = buildCardNameIndex(catalog);
    expect(resolveCardName(index, { cardId: RUMBLE_PRINTING, englishName: "ignored" })).toBe("兰博");
    expect(resolveCardName(index, { cardId: RUMBLE_CANONICAL })).toBe("兰博");
    expect(resolveCardName(index, { englishName: "Treasure Hoard" })).toBe("珍宝堆");
    expect(resolveCardName(index, { cardId: "card.hash-fallback", englishName: "No Localization" }))
      .toBe("No Localization");
    expect(resolveCardName(index, { cardId: "missing-card" })).toBe("missing-card");
    expect(buildCardNameIndex([
      catalogCard("Shared", "共享甲", "a", "canonical-a"),
      catalogCard("Shared", "共享乙", "b", "canonical-b"),
    ]).localizedByEnglishName.has("Shared")).toBe(false);
  });

  it("uses Chinese names in the hand, zones, battlefields, runes, move/play choices, and aria labels", () => {
    const html = render(projection(), catalog);
    const hand = panel(html, "我的手牌");
    expect(hand).toContain("兰博");
    expect(hand).toContain('aria-label="选择打出 兰博"');
    expect(hand).toContain('title="Rumble"');
    expect(hand).not.toContain(">Rumble</strong>");

    expect(panel(html, "我的基地")).toContain("兰博");
    expect(panel(html, "战场 · 珍宝堆（我方控制）")).toContain("暂无公开牌");
    expect(panel(html, "传奇与英雄")).toContain("不灭狂雷");
    expect(panel(html, "传奇与英雄")).toContain("菲奥娜");
    expect(panel(html, "我的符文")).toContain("炽烈符文");
    const runePanel = panel(html, "符文操作");
    expect(runePanel).toContain('aria-label="炽烈符文 取能量"');
    const place = html.slice(html.indexOf('aria-label="永久物落点"'));
    expect(place).toContain("战场 珍宝堆");
    expect(place).not.toContain("战场 Treasure Hoard");
    expect(panel(html, "移动操作")).toContain("兰博");
  });

  it("uses Chinese names for object choices and their source while keeping unreferenced text intact", () => {
    const pendingChoice: V2PendingChoice = {
      status: "pending", choiceId: "choose-rumble", ownerPlayerId: "alice", stateVersion: 9,
      kind: "select-objects", min: 1, max: 1,
      source: { objectId: "unit-1", name: "Rumble" },
      prompt: "Choose a unit.",
      options: [{ id: "unit-1", label: "Rumble", objectRef: { objectId: "unit-1", zoneEntryId: 1 } }],
    };
    const html = render(projection({ pendingChoice }), catalog);
    const choice = panel(html, "选择请求");
    expect(choice).toContain("来源：兰博");
    expect(choice).toContain(">兰博</button>");
    expect(choice).toContain("Choose a unit.");

    const plain: V2PendingChoice = {
      status: "pending", choiceId: "mode", ownerPlayerId: "alice", stateVersion: 9,
      kind: "mode", options: [{ id: "mode-a", label: "Rumble or another effect" }],
    };
    expect(panel(render(projection({ pendingChoice: plain }), catalog), "选择请求"))
      .toContain("Rumble or another effect");
  });

  it("uses Chinese names for target candidates and Finalize target requirements", () => {
    const targetChoice: V2PendingChoice = {
      status: "pending", choiceId: "target-rumble", ownerPlayerId: "alice", stateVersion: 9,
      kind: "select-objects", min: 1, max: 1,
      options: [{ id: "unit-1", label: "Rumble", value: "unit-1",
        objectRef: { objectId: "unit-1", zoneEntryId: 1 } }],
    };
    const targetProjection = projection({ pendingChoice: targetChoice });
    targetProjection.objects = targetProjection.objects.map(candidate => candidate.objectId === "unit-1"
      ? { ...candidate, visibility: "public" as const }
      : candidate);
    const targetHtml = render(targetProjection, catalog);
    expect(panel(targetHtml, "服务端投影候选目标")).toContain(">兰博</button>");

    const finalize = projection();
    finalize.actionOptions = {
      ...finalize.actionOptions,
      plays: [{
        cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" }, requiresDestination: false,
        targetRequirements: [{ id: "friendly-unit", label: "友方单位", kind: "object", min: 1, max: 1,
          options: [{ id: "unit-1", label: "Rumble", objectRef: { objectId: "unit-1", zoneEntryId: 1 } }] }],
      }],
    };
    const finalizeHtml = render(finalize, catalog);
    expect(finalizeHtml).toContain('aria-label="选择友方单位：兰博"');
    expect(finalizeHtml).toContain(">兰博</button>");
  });

  it("uses Chinese names in event logs but does not translate arbitrary string values", () => {
    const events = panel(render(projection(), catalog), "对局日志");
    expect(events).toContain("objectId: 兰博");
    expect(events).toContain(`cardId: 兰博`);
    expect(events).toContain("battlefieldId: 珍宝堆");
    expect(events).toContain("note: ordinary text");
  });

  it("falls back to the projected English name or card id when localization is absent or unloaded", () => {
    const missing = render(projection(), catalog);
    expect(panel(missing, "我的基地")).toContain("No Localization");
    expect(missing).toContain('aria-label="选择打出 兰博"');

    const unloaded = render(projection());
    expect(unloaded).toContain(">Rumble</strong>");
    expect(unloaded).toContain('aria-label="选择打出 Rumble"');
    expect(unloaded).not.toContain("兰博");
    expect(unloaded).toContain("战场 Treasure Hoard");
  });

  it("renders the mulligan hand and result panel with official names and no directory", () => {
    const setupObjects = [object("opening-1", RUMBLE_CANONICAL, "Rumble", "hand")];
    const setup = projection({
      phase: "setup",
      zones: [{ zone: "hand", ownerPlayerId: "alice", count: 1, objects: setupObjects },
        { zone: "hand", ownerPlayerId: "bob", count: 4 }],
      objects: setupObjects,
      scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      ] },
      battlefields: [],
      actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
      pendingChoice: { status: "pending", choiceId: "mulligan:alice", ownerPlayerId: "alice",
        stateVersion: 9, kind: "select-objects", options: [{ id: "opening-1", label: "Rumble",
          objectRef: { objectId: "opening-1", zoneEntryId: 1 } }], min: 0, max: 2 },
    });
    expect(panel(render(setup, catalog), "起手换牌")).toContain("选择至多 2 张");
    expect(render(setup, catalog)).toContain('aria-label="选择调度 兰博"');

    const ended = projection({ phase: "ended", winnerPlayerId: "alice" });
    expect(render(ended)).toContain("胜者：Alice");
    expect(render(ended)).toContain("比分：Alice 1 : Bob 0");
    expect(render(ended)).toContain("你获胜");
  });
});
