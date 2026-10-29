import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { buildV2CardLookup, V2CardPreview, v2CardDetails, v2PlaymatCards } from "../../src/full-product/v2/V2Playmat";
import {
  V2_DRAG_THRESHOLD_PX,
  v2DragReducer,
  v2MoveDropTargets,
  v2PlayDropTargets,
  v2PlayNeedsSelection,
  v2RuneCanAddEnergy,
  v2RuneCanAddPower,
  type V2DragState
} from "../../src/full-product/v2/playmat-interactions";
import { CardPreviewOverlay, closeOnBackdropClick } from "../../src/full-product/duel/DuelOverlays";
import { buildCardNameIndex } from "../../src/full-product/v2/card-names";
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

function render(cards: readonly CatalogCard[] = catalog, value: V2Projection = projection()): string {
  return renderToStaticMarkup(<V2MatchBoard state={state(value)} initialCatalogCards={cards} onCommand={vi.fn()} />);
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
    // Official zh_CN gallery wording for exhausted (ven-075-166 / unl-136-219).
    expect(field).toContain("休眠");
    expect(field).not.toContain("横置");
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

  it("always shows universal power, including when it is zero, without mislabeling it as a domain", () => {
    expect(region(html, "Alice 卡垫区域")).toContain("通用符能：</dt><dd>0<");
    expect(region(html, "Bob 卡垫区域")).toContain("通用符能：</dt><dd>0<");
    const base = projection();
    const charged: V2Projection = {
      ...base,
      players: base.players.map(player => player.playerId === "alice"
        ? { ...player, power: { fury: 1, any: 2, chaos: 1 } } : player)
    };
    const alice = region(render(catalog, charged), "Alice 卡垫区域");
    expect(alice).toContain("通用符能：</dt><dd>2<");
    expect(alice).toContain("混沌符能：</dt><dd>1<");
    expect(alice.match(/通用符能/g)).toHaveLength(1);
    expect(alice.toLowerCase()).not.toContain("any符能");
  });

  it("shows the catalog's official Chinese effect text in the large-card preview", () => {
    const official: CatalogCard = {
      ...card("sfd-026", "Rumble", "兰博", "Unit"),
      ability: "English rules",
      localizedAbilityStatus: "official-structured",
      localizedAbilityLanguage: "zh-CN",
      localizedAbilityEffectText: "<p>此牌以休眠状态进场。</p>",
      localizedAbilitySource: { url: "https://example.test/zh_CN", locale: "zh-CN",
        updatedAt: "2026-10-28T00:00:00Z", syncedAt: "2026-10-28T00:00:00Z" }
    };
    const cards = [official, ...catalog.filter(entry => entry.id !== "sfd-026")];
    const playmat = v2PlaymatCards(projection(), buildCardNameIndex(cards), buildV2CardLookup(cards));
    const preview = renderToStaticMarkup(<V2CardPreview cardId="sfd-026" cards={playmat} onClose={vi.fn()} />);
    expect(preview).toContain("兰博");
    expect(preview).toContain('aria-label="官方中文卡牌文本"');
    expect(preview).toContain("此牌以休眠状态进场。");
    expect(preview).not.toContain("English rules");
    expect(playmat.text("canonical-sfd-026")).toBe(official);
    expect(playmat.text("unknown-card")).toBeUndefined();
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

// RIFT-1144: bigger click targets, rune clicks (left: Energy, right: Power),
// drag-and-drop play/move and the split card preview.
describe("RIFT-1144 playmat interactions", () => {
  function withActions(patch: Partial<V2Projection["actionOptions"]>, mutate?: (value: V2Projection) => V2Projection): V2Projection {
    const base = projection();
    const next = { ...base, actionOptions: { ...base.actionOptions, ...patch } };
    return mutate ? mutate(next) : next;
  }

  it("lists play drop zones from the projected play options only", () => {
    const value = withActions({ plays: [
      { cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" }, requiresDestination: true },
      { cardObjectId: "hand-1", destination: { kind: "battlefield", battlefieldId: "field-2" }, requiresDestination: true }
    ] });
    expect([...v2PlayDropTargets(value, "hand-1").keys()]).toEqual(["base:alice", "battlefield:field-2"]);
    expect(v2PlayDropTargets(value, "unit-1").size).toBe(0);
    // A card that needs no destination can be dropped on any of the viewer's zones.
    const spell = withActions({ plays: [
      { cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" }, requiresDestination: false }
    ] });
    expect([...v2PlayDropTargets(spell, "hand-1").keys()]).toEqual(["base:alice", "battlefield:field-1", "battlefield:field-2"]);
    // Older projections without actionOptions offer no drops.
    expect(v2PlayDropTargets({ ...value, actionOptions: undefined } as unknown as V2Projection, "hand-1").size).toBe(0);
  });

  it("asks for side-panel targets instead of sending a play that needs them", () => {
    expect(v2PlayNeedsSelection({ cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" } })).toBe(false);
    expect(v2PlayNeedsSelection({ cardObjectId: "hand-1", destination: { kind: "base", playerId: "alice" },
      targetRequirements: [{ id: "t", label: "目标", min: 1, max: 1, options: [] }] })).toBe(true);
  });

  it("lists move drop zones exactly as the server lists the unit's moves", () => {
    const value = withActions({ moves: [
      { objectId: "unit-1", destination: { kind: "battlefield", battlefieldId: "field-2" } },
      { objectId: "unit-2", destination: { kind: "base", playerId: "bob" } }
    ] });
    expect([...v2MoveDropTargets(value, "unit-1").entries()]).toEqual([
      ["battlefield:field-2", { kind: "battlefield", battlefieldId: "field-2" }]
    ]);
    expect(v2MoveDropTargets(value, "hand-1").size).toBe(0);
  });

  it("keeps a short press a click and starts a drag past the threshold", () => {
    const start: V2DragState = { source: { kind: "play", objectId: "hand-1", label: "兰博" },
      startX: 100, startY: 100, x: 100, y: 100, active: false, overKey: null };
    const small = v2DragReducer(start, { type: "move", x: 100 + V2_DRAG_THRESHOLD_PX - 1, y: 100, overKey: null });
    expect(small?.active).toBe(false);
    const far = v2DragReducer(small, { type: "move", x: 140, y: 130, overKey: "base:alice" });
    expect(far).toMatchObject({ active: true, overKey: "base:alice", x: 140, y: 130 });
    // Once active it stays active even when the pointer comes back near the start.
    expect(v2DragReducer(far, { type: "move", x: 101, y: 100, overKey: null })?.active).toBe(true);
    expect(v2DragReducer(far, { type: "cancel" })).toBeNull();
  });

  it("allows Energy only from a ready rune but Power from an exhausted one (CR 164.2.a/b)", () => {
    const ready = object("r1", "ogn-007", "Fury Rune", "rune-zone", "alice");
    const exhausted = { ...ready, exhausted: true };
    expect([v2RuneCanAddEnergy(ready), v2RuneCanAddPower(ready)]).toEqual([true, true]);
    expect([v2RuneCanAddEnergy(exhausted), v2RuneCanAddPower(exhausted)]).toEqual([false, true]);
    const unknownEntry = { ...ready, zoneEntryId: undefined };
    expect([v2RuneCanAddEnergy(unknownEntry), v2RuneCanAddPower(unknownEntry)]).toEqual([false, false]);
  });

  it("renders the viewer's runes as click targets and only the viewer's", () => {
    const html = render();
    const alice = region(html, "Alice 卡垫区域");
    expect(alice).toContain('class="v2-rune-button"');
    expect(alice).toContain("左键横置取能量，右键回收取符能");
    expect(alice).toContain('data-can-energy="true"');
    expect(region(html, "Bob 卡垫区域")).not.toContain("v2-rune-button");
    // Opponent runes keep name and state as a tooltip when short rows hide the caption.
    expect(region(html, "Bob 卡垫区域")).toMatch(/<li class="full-product-duel-baserune v2-rune" data-readied="false" title="[^"]+（[^"]+）"/);
  });

  it("lets an exhausted own rune still be recycled for Power", () => {
    const base = projection();
    const exhaustedOwn: V2Projection = { ...base, objects: base.objects.map(entry =>
      entry.objectId === "rune-1" ? { ...entry, exhausted: true } : entry) };
    const html = renderToStaticMarkup(<V2MatchBoard state={state(exhaustedOwn)} initialCatalogCards={catalog} onCommand={vi.fn()} />);
    const alice = region(html, "Alice 卡垫区域");
    expect(alice).toContain('data-can-energy="false"');
    expect(alice).toContain('data-can-power="true"');
    // The side panel's Power button follows the same rule.
    const runes = html.slice(html.indexOf('aria-label="符文操作"'));
    expect(runes).toMatch(/aria-label="[^"]* 取 Power"[^>]*>取 Power</);
    expect(runes).not.toMatch(/aria-label="[^"]* 取 Power" disabled/);
    expect(runes).toMatch(/aria-label="[^"]* 取能量" disabled/);
  });

  it("marks the viewer's base and both battlefields as drop zones and the playable hand card as draggable", () => {
    const html = render();
    expect(html).toContain('data-drop-key="base:alice"');
    expect(html).toContain('data-drop-key="base:bob"');
    expect(html).toContain('data-drop-key="battlefield:field-1"');
    expect(html).toContain('data-drop-key="battlefield:field-2"');
    expect(html).not.toContain("data-drop-state");
    expect(region(html, "我的手牌")).toContain("v2-card v2-draggable");
  });

  it("shows the large preview as image left, facts and official text right", () => {
    const official: CatalogCard = { ...card("sfd-026", "Rumble", "兰博", "Unit", ["Fury"]),
      cardNumber: "SFD-026/221", energy: 4, might: 4, ability: "",
      localizedAbilityStatus: "official-structured", localizedAbilityLanguage: "zh-CN",
      localizedAbilityRulesText: "<p>你的机械获得强攻。</p>",
      localizedAbilitySource: { url: "https://example.test/zh_CN", locale: "zh-CN",
        updatedAt: "2026-10-28T00:00:00Z", syncedAt: "2026-10-28T00:00:00Z" } };
    expect(v2CardDetails(official)).toEqual(["单位", "炽烈", "费用 4", "战力 4", "SFD-026/221"]);
    const cards = [official, ...catalog.filter(entry => entry.id !== "sfd-026")];
    const playmat = v2PlaymatCards(projection(), buildCardNameIndex(cards), buildV2CardLookup(cards));
    const preview = renderToStaticMarkup(<V2CardPreview cardId="sfd-026" cards={playmat} onClose={vi.fn()} />);
    expect(preview).toContain("full-product-duel-preview-body is-split");
    const art = preview.indexOf("full-product-duel-preview-art");
    const info = preview.indexOf("full-product-duel-preview-info");
    expect(art).toBeGreaterThan(-1);
    expect(info).toBeGreaterThan(art);
    expect(preview.indexOf("<img")).toBeGreaterThan(art);
    expect(preview.indexOf("<img")).toBeLessThan(info);
    for (const detail of ["单位", "炽烈", "费用 4", "战力 4", "SFD-026/221", "你的机械获得强攻。"]) {
      expect(preview.slice(info)).toContain(detail);
    }
    // Without text or facts the preview stays the plain single-image layout.
    const plain = renderToStaticMarkup(<CardPreviewOverlay cardId="x" title="X" imageUrl={null} onClose={vi.fn()} />);
    expect(plain).not.toContain("is-split");
  });

  it("closes the preview on a backdrop click but not on a click inside the card", () => {
    const onClose = vi.fn();
    const onClick = closeOnBackdropClick(onClose);
    const backdrop = {};
    onClick({ target: backdrop, currentTarget: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
    onClick({ target: {}, currentTarget: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
