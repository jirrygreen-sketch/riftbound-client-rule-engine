import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { v2CombatResult, V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { v2CardKeywords } from "../../src/full-product/v2/V2Playmat";
import {
  v2AssignDamage,
  v2EventHidden,
  v2EventLabel,
  v2GroupUnits,
  v2OrderedDamageDrafts,
  v2UnassignDamage
} from "../../src/full-product/v2/unit-groups";
import { buildCardNameIndex } from "../../src/full-product/v2/card-names";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2ProjectedObject, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

function token(objectId: string, extra: Partial<V2ProjectedObject> = {}): V2ProjectedObject {
  return { objectId, zoneEntryId: 1, zone: "board", ownerPlayerId: "bob", cardId: "recruit", name: "Recruit",
    faceDown: false, visibility: "public", might: 1, location: { kind: "base", playerId: "bob" }, ...extra };
}

function projection(overrides: Partial<V2Projection> = {}): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-redesign",
    viewerPlayerId: "alice",
    stateVersion: 7,
    eventSeq: 30,
    phase: "main",
    turnNumber: 5,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 2, energy: 3, power: {}, xp: 0, handCount: 1, deckCount: 30, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 3, energy: 0, power: {}, xp: 0, handCount: 4, deckCount: 30, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      ...Array.from({ length: 12 }, (_, index) => token(`recruit-${index + 1}`)),
      { objectId: "guard", zoneEntryId: 3, zone: "board", ownerPlayerId: "alice", cardId: "royal-guard", name: "Royal Guard",
        faceDown: false, visibility: "public", might: 2, location: { kind: "base", playerId: "alice" } },
      { objectId: "spell", zoneEntryId: 4, zone: "hand", ownerPlayerId: "alice", cardId: "knock", name: "Knock Down",
        faceDown: false, visibility: "owner-only" },
      { objectId: "field-1", zone: "battlefield", ownerPlayerId: "alice", cardId: "field-card", name: "Minefield", faceDown: false, visibility: "public" }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "alice", points: 2, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "bob", points: 3, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: null, contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, canPass: true,
      moves: [{ objectId: "guard", destination: { kind: "battlefield", battlefieldId: "field-1" } }], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [],
    ...overrides
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
}

function render(value: V2Projection, drafts?: Readonly<Record<string, string>>): string {
  return renderToStaticMarkup(<V2MatchBoard state={state(value)} initialCatalogCards={[]} onCommand={vi.fn()}
    {...(drafts === undefined ? {} : { initialCombatDamageDrafts: drafts })} />);
}

function mainButton(html: string): string {
  const start = html.indexOf('class="v2t-main');
  return html.slice(html.lastIndexOf("<button", start), html.indexOf("</button>", start));
}

describe("RIFT-1146 stacks of identical permanents", () => {
  it("stacks identical tokens and keeps different states apart", () => {
    const tokens = [token("a"), token("b"), token("c", { exhausted: true }), token("d", { damage: 1 }), token("e", { faceDown: true }), token("f", { faceDown: true })];
    const groups = v2GroupUnits(tokens);
    expect(groups.map(group => group.objects.map(object => object.objectId))).toEqual([["a", "b"], ["c"], ["d"], ["e"], ["f"]]);
  });

  it("never merges the same token in different locations into one stack key", () => {
    const [base, field] = v2GroupUnits([token("a"), token("b", { location: { kind: "battlefield", battlefieldId: "field-1" } })]);
    expect(base!.key).not.toBe(field!.key);
  });

  it("draws twelve tokens in one base as a single ×12 stack that keeps every object id", () => {
    const html = render(projection());
    const base = html.slice(html.indexOf('aria-label="对手基地"'), html.indexOf('aria-label="Bob 传奇与英雄"'));
    expect(base.match(/class="v2m-stack/g)).toHaveLength(1);
    expect(base).toContain('class="v2m-count">×12</span>');
    expect(base).toContain('aria-label="Recruit ×12"');
    expect(base).toContain(`data-object-ids="${Array.from({ length: 12 }, (_, index) => `recruit-${index + 1}`).join(" ")}"`);
  });

  it("gives a movable unit the blue operable glow", () => {
    const html = render(projection());
    const guard = html.slice(html.indexOf('data-object-id="guard"') - 80, html.indexOf('data-object-id="guard"'));
    expect(guard).toContain("v2-operable");
  });
});

describe("RIFT-1146 on-board damage allocation", () => {
  const units = [token("x", { might: 2 }), token("y", { might: 3, damage: 1 }), token("z", { might: 4 })];

  it("tops each clicked unit up to lethal in order and never exceeds the budget", () => {
    let plan = v2AssignDamage({ drafts: {}, order: [] }, [units[1]!], 5);
    expect(plan).toEqual({ drafts: { y: "2" }, order: ["y"] });
    plan = v2AssignDamage(plan, [units[0]!, units[2]!], 5);
    expect(plan).toEqual({ drafts: { y: "2", x: "2", z: "1" }, order: ["y", "x", "z"] });
    expect(v2AssignDamage(plan, [units[0]!], 5)).toBe(plan);
  });

  it("sends a click on a lethal unit to the next target that is not yet lethal (CR 467.2.c.3/.c.4)", () => {
    const targets = [units[0]!, units[1]!];
    const lethal = v2AssignDamage({ drafts: {}, order: [] }, [units[0]!], 4, targets);
    expect(lethal.drafts).toEqual({ x: "2" });
    // x is lethal while y can still take lethal damage: the extra damage goes to y, not x.
    const next = v2AssignDamage(lethal, [units[0]!], 4, targets);
    expect(next).toEqual({ drafts: { x: "2", y: "2" }, order: ["x", "y"] });
    expect(next.drafts.x).toBe("2");
  });

  it("overflows onto a lethal unit only once every target is lethal, and takes points back on right click", () => {
    const lethal = v2AssignDamage({ drafts: {}, order: [] }, [units[0]!], 6, [units[0]!]);
    const extra = v2AssignDamage(lethal, [units[0]!], 6, [units[0]!]);
    expect(extra.drafts).toEqual({ x: "3" });
    expect(v2UnassignDamage(v2UnassignDamage(v2UnassignDamage(extra, [units[0]!]), [units[0]!]), [units[0]!]))
      .toEqual({ drafts: {}, order: [] });
  });

  it("sends only assigned units, clicked order first", () => {
    expect(v2OrderedDamageDrafts({ drafts: { z: "1", x: "2" }, order: ["z"] }, units)).toEqual([
      { unitObjectId: "z", amount: "1" },
      { unitObjectId: "x", amount: "2" }
    ]);
  });

  it("lets a budget that covers one enemy submit without touching the others", () => {
    const value = projection({
      objects: [
        { objectId: "enemy-1", zoneEntryId: 11, zone: "board", ownerPlayerId: "bob", cardId: "e1", name: "Enemy One", faceDown: false,
          visibility: "public", might: 3, location: { kind: "battlefield", battlefieldId: "field-1" } },
        { objectId: "enemy-2", zoneEntryId: 12, zone: "board", ownerPlayerId: "bob", cardId: "e2", name: "Enemy Two", faceDown: false,
          visibility: "public", might: 2, location: { kind: "battlefield", battlefieldId: "field-1" } },
        { objectId: "mine", zoneEntryId: 13, zone: "board", ownerPlayerId: "alice", cardId: "m", name: "Mine", faceDown: false,
          visibility: "public", might: 3, location: { kind: "battlefield", battlefieldId: "field-1" } }
      ],
      battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "bob", contestedByPlayerId: "alice", staged: "combat",
        occupantObjectIds: ["enemy-1", "enemy-2", "mine"] }],
      combat: { status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1", attackerPlayerId: "alice", defenderPlayerId: "bob",
        damage: { attackerMight: 3, defenderMight: 5, attackerSubmitted: false, expectedPlayerId: "alice" } },
      actionOptions: { canEndTurn: false, canAdvance: false, canPass: false, moves: [], plays: [] }
    });
    const html = render(value, { "enemy-1": "3" });
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>提交战斗伤害<\/button>/u);
    expect(mainButton(html)).toContain("确认伤害");
    expect(mainButton(html)).not.toContain("disabled");
    expect(html).toContain("将阵亡");
    expect(html.replace(/<!-- -->/gu, "")).toContain('aria-label="伤害分配进度">分配 3 / 3');
    expect(html).toContain("你（攻）");
  });
});

describe("RIFT-1146 chain rail, response prompt and main action", () => {
  const chained = projection({
    objects: [
      ...projection().objects,
      { objectId: "freeze", zoneEntryId: 9, zone: "chain", ownerPlayerId: "bob", cardId: "freeze", name: "Freeze", faceDown: false, visibility: "public" }
    ],
    chain: { status: "open", phase: "resolve", priorityPlayerId: "alice", focusPlayerId: null, items: [
      { itemId: "i1", controllerPlayerId: "alice", status: "finalized", kind: "triggered", sourceObjectId: "guard" },
      { itemId: "i2", controllerPlayerId: "bob", status: "finalized", kind: "spell", sourceObjectId: "freeze" }
    ] },
    priority: { playerId: "alice", focusPlayerId: null, window: "closed" },
    actionOptions: { canEndTurn: false, canAdvance: false, canPass: true, moves: [],
      plays: [{ cardObjectId: "spell", destination: { kind: "base", playerId: "alice" }, requiresDestination: false }] }
  });

  it("lists chain items newest first with numbers and Chinese kinds", () => {
    const html = render(chained);
    const rail = html.slice(html.indexOf('aria-label="链与优先权"'), html.indexOf("</section>", html.indexOf('aria-label="链与优先权"')));
    expect(rail).toContain("优先权：Alice");
    expect(rail.indexOf("Freeze")).toBeLessThan(rail.indexOf("Royal Guard"));
    expect(rail).toContain("法术");
    expect(rail).toContain("触发");
    expect(rail).toContain("下一个结算");
    expect(rail).toContain('class="v2t-chain-n">2<');
  });

  it("asks whether to respond when the viewer holds priority and has a playable card", () => {
    const html = render(chained);
    expect(html).toContain('aria-label="响应确认"');
    expect(html).toContain("Bob的法术【Freeze】在链上（第 2 项）");
    expect(html).toContain("你有 1 张牌可以响应");
    expect(mainButton(html)).toContain("让过");
    expect(mainButton(html)).toContain("结算 2 Freeze");
  });

  it("does not ask in the default mode when nothing can be played", () => {
    const html = render({ ...chained, actionOptions: { ...chained.actionOptions, plays: [] } });
    expect(html).not.toContain('aria-label="响应确认"');
    expect(mainButton(html)).toContain("让过");
  });

  it("offers end turn on an empty chain and waits while the opponent holds priority", () => {
    expect(mainButton(render(projection()))).toContain("结束回合");
    const waiting = render(projection({
      priority: { playerId: "bob", focusPlayerId: null, window: "open" },
      actionOptions: { canEndTurn: false, canAdvance: false, canPass: false, moves: [], plays: [] }
    }));
    expect(mainButton(waiting)).toContain("等待 Bob");
    expect(mainButton(waiting)).toContain("disabled");
  });

  it("names the showdown focus in the banner", () => {
    const html = render(projection({
      priority: { playerId: "alice", focusPlayerId: "alice", window: "showdown" },
      combat: { status: "active", battlefieldId: "field-1", step: "showdown" }
    }));
    expect(html).toContain("Minefield · 对决 — 焦点：你");
  });
});

describe("RIFT-1146 combat summary, keywords and log", () => {
  it("summarises kills on both sides and the new controller from public events", () => {
    const value = projection({
      battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "alice", contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }],
      objects: [...projection().objects,
        { objectId: "dead-bob", zone: "trash", ownerPlayerId: "bob", cardId: "recruit", name: "Recruit", faceDown: false, visibility: "public" },
        { objectId: "dead-bob-2", zone: "trash", ownerPlayerId: "bob", cardId: "recruit", name: "Recruit", faceDown: false, visibility: "public" },
        { objectId: "dead-alice", zone: "trash", ownerPlayerId: "alice", cardId: "yeti", name: "Yeti", faceDown: false, visibility: "public" }]
    });
    const killed = (eventSeq: number, objectId: string) => ({ eventSeq, timingPoint: "object-killed",
      payload: { objectId: { visibility: "public" as const, value: objectId } } });
    const result = v2CombatResult(value, [killed(31, "dead-bob"), killed(32, "dead-bob-2"), killed(33, "dead-alice"), killed(20, "guard")],
      { battlefieldId: "field-1", fromSeq: 30, contested: true }, buildCardNameIndex([]));
    expect(result).toEqual({ battlefieldId: "field-1", title: "你赢得Minefield之战", lines: ["击杀：Recruit ×2", "损失：Yeti"] });
    expect(v2CombatResult(value, [], { battlefieldId: "field-1", fromSeq: 30, contested: false }, buildCardNameIndex([])).title)
      .toBe("你占领了Minefield");
  });

  it("reads keywords only from official Chinese text", () => {
    const base = { id: "c", canonicalCardId: "c", name: "C", fullName: "C", cardType: "Unit", domains: [], tags: [], setCode: "SFD",
      cardNumber: "SFD-1", variant: "standard", imageUrl: null, energy: 2, power: null, might: 2, ability: "[Tank] English" } as unknown as CatalogCard;
    expect(v2CardKeywords(base)).toEqual([]);
    expect(v2CardKeywords({ ...base, localizedAbilityStatus: "official-structured",
      localizedAbilityRulesText: "<p>[坚守] [强攻 2]</p>", localizedAbilityEffectText: "<p>[坚守] 此牌以休眠状态进场。</p>" }))
      .toEqual(["坚守", "强攻 2"]);
  });

  it("hides housekeeping events and titles the rest in Chinese", () => {
    expect(["cleanup-start", "main-end", "object-leaves-zone", "object-enters-zone"].map(v2EventHidden)).toEqual([true, true, true, true]);
    expect(["card-played", "combat-end", "turn-end"].map(v2EventHidden)).toEqual([false, false, false]);
    expect(v2EventLabel("chain-item-resolve")).toBe("结算");
    expect(v2EventLabel("unknown-point")).toBe("unknown-point");
  });
});
