import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { buildV2CardLookup } from "../../src/full-product/v2/V2Playmat";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2ProjectedObject, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1125: the in-match V2 board is the Duel playmat — mirrored seats, two
// shared battlefields between them, card faces and an opposing hand of backs —
// while every V2 command control stays in the sidebar.

const image = (id: string) => `https://cards.example/${id}.png`;

function card(id: string, name: string, localizedName: string, cardType: string, domains: readonly string[] = []): CatalogCard {
  return {
    id, canonicalCardId: `canonical-${id}`, name, fullName: name, localizedName, cardType, domains: [...domains], tags: [],
    setCode: "SFD", cardNumber: id, variant: "standard", imageUrl: image(id), energy: 2, power: null, might: 3, ability: ""
  };
}

const catalog: readonly CatalogCard[] = [
  card("sfd-026", "Rumble", "兰博", "Unit"),
  card("sfd-110", "Fiora", "菲奥娜", "Unit"),
  card("sfd-220", "Treasure Hoard", "珍宝堆", "Battlefield"),
  card("sfd-221", "Vilemaw's Lair", "巨眼蛛巢", "Battlefield"),
  card("ogn-007", "Fury Rune", "炽烈符文", "Rune"),
  card("sfd-181", "Mechanized Menace", "机械狂潮", "Legend", ["Fury", "Mind"]),
  card("sfd-205", "Grand Duelist", "无双剑姬", "Legend", ["Order", "Body"])
];

function object(objectId: string, cardId: string, name: string, zone: V2ProjectedObject["zone"], owner: string,
  extra: Partial<V2ProjectedObject> = {}): V2ProjectedObject {
  return { objectId, zoneEntryId: 1, zone, ownerPlayerId: owner, cardId, name, faceDown: false, visibility: "public", ...extra };
}

function projection(): V2Projection {
  const handCard = object("hand-1", "sfd-026", "Rumble", "hand", "alice", { visibility: "owner-only" });
  const baseUnit = object("unit-1", "sfd-026", "Rumble", "board", "alice",
    { controllerPlayerId: "alice", location: { kind: "base", playerId: "alice" }, might: 3 });
  const fieldUnit = object("unit-2", "sfd-110", "Fiora", "board", "bob",
    { controllerPlayerId: "bob", location: { kind: "battlefield", battlefieldId: "field-1" }, might: 4, exhausted: true, damage: 1 });
  const field1 = object("field-1", "sfd-220", "Treasure Hoard", "battlefield", "alice");
  const field2 = object("field-2", "sfd-221", "Vilemaw's Lair", "battlefield", "bob");
  const runeA = object("rune-1", "ogn-007", "Fury Rune", "rune-zone", "alice");
  const runeB = object("rune-2", "ogn-007", "Fury Rune", "rune-zone", "bob", { exhausted: true });
  const legendA = object("legend-a", "sfd-181", "Mechanized Menace", "legend", "alice");
  const legendB = object("legend-b", "sfd-205", "Grand Duelist", "legend", "bob");
  return {
    projectionContract: "riftbound.protocol.v2.projection", protocolVersion: "2.0.0", rulesetVersion: "core-1.5",
    matchId: "match-1125", viewerPlayerId: "alice", stateVersion: 12, eventSeq: 30, phase: "main", turnNumber: 3,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 2, energy: 3, power: { fury: 1 }, xp: 0, handCount: 1, deckCount: 31, runeDeckCount: 7,
        zoneCounts: { trash: 2 } },
      { playerId: "bob", name: "Bob", score: 1, energy: 0, power: {}, xp: 0, handCount: 4, deckCount: 30, runeDeckCount: 8,
        zoneCounts: { trash: 0 } }
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "alice", count: 1, objects: [handCard] },
      { zone: "hand", ownerPlayerId: "bob", count: 4 }
    ],
    objects: [handCard, baseUnit, fieldUnit, field1, field2, runeA, runeB, legendA, legendB],
    chain: { status: "open", phase: "open", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1", "field-2"], players: [
      { playerId: "alice", points: 2, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "bob", points: 1, controlledBattlefieldIds: ["field-1"], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [
      { battlefieldId: "field-1", controllerPlayerId: "bob", contestedByPlayerId: null, staged: "none", occupantObjectIds: ["unit-2"] },
      { battlefieldId: "field-2", controllerPlayerId: null, contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }
    ],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, canPass: true, moves: [],
      plays: [{ cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" }, requiresDestination: true }] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0 }),
    projection: value, stateVersion: value.stateVersion, eventSeq: value.eventSeq, connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0 })
  };
}

function render(cards: readonly CatalogCard[] = catalog): string {
  return renderToStaticMarkup(<V2MatchBoard state={state(projection())} initialCatalogCards={cards} onCommand={vi.fn()} />);
}

function region(html: string, ariaLabel: string): string {
  const start = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(start, ariaLabel).toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe("RIFT-1125 V2 playmat board", () => {
  const html = render();

  it("uses the shared Duel table shell with mirrored seats around the two battlefields", () => {
    for (const label of ["对局桌面", "对手手牌", "中央战场", "我方基地", "手牌", "操作面板"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-label="Bob 卡垫区域"');
    expect(html).toContain('aria-label="Alice 卡垫区域"');
    expect(html.indexOf('aria-label="Bob 卡垫区域"')).toBeLessThan(html.indexOf('aria-label="中央战场 珍宝堆"'));
    expect(html.indexOf('aria-label="中央战场 巨眼蛛巢"')).toBeLessThan(html.indexOf('aria-label="Alice 卡垫区域"'));
    expect(html).toContain('data-position="opponent"');
    expect(html).toContain('data-position="player"');
  });

  it("shows only card backs and a count for the opposing hand", () => {
    expect(html).toContain('aria-label="Bob 手牌区，共 4 张，牌面隐藏"');
    expect(region(html, "对手手牌")).not.toContain("兰博");
  });

  it("draws card faces from the catalog for hand, legend, runes, base and battlefield cards", () => {
    expect(region(html, "我的手牌")).toContain(`src="${image("sfd-026")}"`);
    expect(region(html, "Alice 传奇与英雄")).toContain(`src="${image("sfd-181")}"`);
    expect(region(html, "Bob 传奇与英雄")).toContain(`src="${image("sfd-205")}"`);
    expect(region(html, "中央战场 珍宝堆")).toContain(`src="${image("sfd-220")}"`);
    expect(region(html, "中央战场 珍宝堆")).toContain(`src="${image("sfd-110")}"`);
    expect(region(html, "Alice 卡垫区域")).toContain(`src="${image("ogn-007")}"`);
  });

  it("places permanents by location with their state, in Chinese names", () => {
    const field = region(html, "中央战场 珍宝堆");
    expect(field).toContain("菲奥娜");
    expect(field).toContain("横置");
    expect(field).toContain("战力 4");
    expect(field).toContain("伤害 1");
    expect(field).toContain("控制者：Bob");
    expect(field).not.toContain("兰博");
    expect(region(html, "中央战场 巨眼蛛巢")).toContain("暂无公开牌");
    expect(region(html, "Alice 卡垫区域")).toContain("兰博");
  });

  it("shows piles, score and the seat's rune pool with its Legend's two domains", () => {
    const alice = region(html, "Alice 卡垫区域");
    expect(alice).toContain('aria-label="Alice 主牌堆">31<');
    expect(alice).toContain('aria-label="Alice 符文库">7<');
    expect(alice).toContain('aria-label="Alice 废牌堆">2<');
    expect(alice).toContain('aria-label="Alice 得分">2<');
    expect(alice).toContain("能量：</dt><dd>3<");
    expect(alice).toContain("炽烈符能：</dt><dd>1<");
    expect(alice).toContain("灵光符能：</dt><dd>0<");
    expect(html).toContain("比分 Alice 2 : Bob 1");
  });

  it("keeps every V2 command control in the sidebar and offers a read-only preview for hand cards", () => {
    const actions = region(html, "操作面板");
    expect(actions).toContain('aria-label="出牌目标"');
    for (const control of ["打出手牌", "Pass", "结束回合", "认输"]) expect(html).toContain(`>${control}</button>`);
    expect(region(html, "我的手牌")).toContain('aria-label="选择打出 兰博"');
    expect(region(html, "我的手牌")).toContain('aria-label="查看大图：兰博"');
  });

  it("still renders names and empty faces when the catalog is not loaded", () => {
    const bare = render([]);
    expect(region(bare, "中央战场 Treasure Hoard")).toContain("Fiora");
    expect(region(bare, "我的手牌")).toContain('class="v2-hand-face is-missing"');
    expect(buildV2CardLookup([]).imageById.size).toBe(0);
  });
});
