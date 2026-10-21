import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  buildV2ChoiceAnswer,
  buildV2DeclareCombatCommand,
  buildV2MoveCommand,
  buildV2RuneCommand,
  V2MatchBoard
} from "../src/full-product/v2/V2MatchBoard";
import { buildV2PreconSubmission, validateV2PreconShape } from "../src/full-product/v2/m1-precons";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../src/state/v2";
import type { CatalogCard } from "../src/net/CardCatalogClient";
import type { V2PendingChoice, V2Projection } from "../../../../packages/protocol/src/v2/index.js";

function projection(pendingChoice: V2PendingChoice = { status: "none" }): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-v2",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 1, energy: 3, power: { Fury: 1 }, xp: 0, handCount: 1, deckCount: 20, runeDeckCount: 10, zoneCounts: { "rune-zone": 1 } },
      { playerId: "player-2", name: "Bob", score: 2, energy: 1, power: {}, xp: 0, handCount: 5, deckCount: 20, runeDeckCount: 10, zoneCounts: {} }
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "player-1", count: 1, objects: [{ objectId: "hand-1", zone: "hand", ownerPlayerId: "player-1", cardId: "spell", name: "Show of Strength", faceDown: false, visibility: "owner-only" }] },
      { zone: "hand", ownerPlayerId: "player-2", count: 5 },
      { zone: "rune-zone", ownerPlayerId: "player-1", count: 1, objects: [{ objectId: "rune-1", zoneEntryId: 7, zone: "rune-zone", ownerPlayerId: "player-1", cardId: "rune", name: "Fury Rune", faceDown: false, visibility: "public" }] }
    ],
    objects: [
      { objectId: "hand-1", zone: "hand", ownerPlayerId: "player-1", cardId: "spell", name: "Show of Strength", faceDown: false, visibility: "owner-only" },
      { objectId: "rune-1", zoneEntryId: 7, zone: "rune-zone", ownerPlayerId: "player-1", cardId: "rune", name: "Fury Rune", faceDown: false, visibility: "public" },
      { objectId: "unit-1", zone: "base", ownerPlayerId: "player-1", controllerPlayerId: "player-1", cardId: "unit", name: "Rumble", faceDown: false, visibility: "public", location: { kind: "base", playerId: "player-1" } }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["battlefield-1"], players: [
      { playerId: "player-1", points: 1, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 2, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    pendingChoice,
    winnerPlayerId: null,
    events: []
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0, timeoutMs: 10_000 })
  };
}

function render(value: V2ClientState): string {
  return renderToStaticMarkup(<V2MatchBoard state={value} onCommand={async () => ({
    type: "command-receipt", protocolVersion: "2.0.0", commandId: "x", stateVersion: 9,
    eventSeq: 4, accepted: true, duplicate: false, rejection: null
  })} />);
}

describe("V2 playable action surface", () => {
  it("ships both complete M1 precon shapes", () => {
    expect(validateV2PreconShape("rumble-sfd")).toBe(true);
    expect(validateV2PreconShape("fiora-sfd")).toBe(true);
  });

  it("renders owned rune, base, battlefield and both player scores from the projection", () => {
    const html = render(state(projection()));
    expect(html).toContain("我的符文");
    expect(html).toContain("取能量");
    expect(html).toContain("取 Power");
    expect(html).toContain("Rumble");
    expect(html).toContain("移动单位");
    expect(html).toContain("比分");
    expect(buildV2RuneCommand("rune-energy", { objectId: "rune-1", zoneEntryId: 7 }))
      .toEqual({ type: "rune-energy", runeObjectId: "rune-1", zoneEntryId: 7 });
  });

  it("builds move destinations from the projected battlefield and owned base", () => {
    expect(buildV2MoveCommand("unit-1", { kind: "battlefield", battlefieldId: "battlefield-1" }))
      .toEqual({ type: "move", objectId: "unit-1", to: { zone: "battlefield", locationId: "battlefield-1" } });
    expect(buildV2MoveCommand("unit-1", { kind: "base", playerId: "player-1" }))
      .toEqual({ type: "move", objectId: "unit-1", to: { zone: "base", playerId: "player-1" } });
  });

  it("renders every pending-choice kind with an explicit answer control", () => {
    const cases: readonly [V2PendingChoice, string][] = [
      [{ status: "pending", choiceId: "optional", ownerPlayerId: "player-1", stateVersion: 9, kind: "optional" }, "可选效果"],
      [{ status: "pending", choiceId: "mode", ownerPlayerId: "player-1", stateVersion: 9, kind: "mode", options: [{ id: "a", label: "模式 A" }] }, "模式"],
      [{ status: "pending", choiceId: "objects", ownerPlayerId: "player-1", stateVersion: 9, kind: "select-objects", options: [{ id: "unit-1", label: "单位" }], min: 1, max: 1 }, "选择对象"],
      [{ status: "pending", choiceId: "order", ownerPlayerId: "player-1", stateVersion: 9, kind: "order", options: [{ id: "first", label: "第一" }], min: 1, max: 1 }, "排序"],
      [{ status: "pending", choiceId: "number", ownerPlayerId: "player-1", stateVersion: 9, kind: "number", min: 0, max: 3 }, "数值"]
    ];
    for (const [pending, label] of cases) expect(render(state(projection(pending)))).toContain(label);
  });

  it("encodes pending choice answers without deriving legality", () => {
    const optional: V2PendingChoice = { status: "pending", choiceId: "optional", ownerPlayerId: "player-1", stateVersion: 9, kind: "optional" };
    const objects: V2PendingChoice = { status: "pending", choiceId: "objects", ownerPlayerId: "player-1", stateVersion: 9, kind: "select-objects", options: [{ id: "unit-1", label: "单位" }], min: 1, max: 1 };
    expect(buildV2ChoiceAnswer(optional, [], "")).toBe(true);
    expect(buildV2ChoiceAnswer(objects, ["unit-1"], "")).toEqual([{ objectId: "unit-1" }]);
    expect(buildV2ChoiceAnswer(optional, [], "", false)).toBe(false);
    expect(buildV2ChoiceAnswer({ ...objects, kind: "number", min: 0, max: 9 }, [], "")).toBeNull();
    expect(buildV2ChoiceAnswer({ ...objects, kind: "number", min: 0, max: 9 }, [], "1.5")).toBeNull();
  });

  it("builds attack and defense packets from selected projected units", () => {
    expect(buildV2DeclareCombatCommand("declare-attack", "battlefield-1", ["unit-1"]))
      .toEqual({ type: "declare-attack", battlefieldId: "battlefield-1", attackerObjectIds: ["unit-1"] });
    expect(buildV2DeclareCombatCommand("declare-defense", "battlefield-1", ["unit-1"]))
      .toEqual({ type: "declare-defense", battlefieldId: "battlefield-1", defenderObjectIds: ["unit-1"] });
  });

  it("maps complete M1 precon identities to server catalog printings only", () => {
    const sourceCanonicals = [
      "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
      "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870",
      "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3",
      "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9",
      "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91",
      "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40",
      "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389",
      "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
      "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab",
      "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
      "card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007",
      "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b",
      "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
      "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9",
      "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b",
      "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf",
      "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10",
      "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
      "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569",
      "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010",
      "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
      "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82",
      "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
      "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b",
      "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902"
    ];
    const cards: CatalogCard[] = sourceCanonicals.map((canonicalCardId, index) => ({
      id: `printing-${index}`, canonicalCardId, name: canonicalCardId, fullName: canonicalCardId,
      cardType: "Unit", domains: [], tags: [], setCode: "sfd", cardNumber: String(index),
      variant: "standard", imageUrl: null, energy: null, power: null, might: null, ability: ""
    }));
    const built = buildV2PreconSubmission("rumble-sfd", cards);
    const total = (zone: keyof typeof built.deck) => built.deck[zone]?.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;
    expect(built.missing).toEqual([]);
    expect([total("legend"), total("champion"), total("mainDeck"), total("battlefields"), total("runes")])
      .toEqual([1, 1, 39, 3, 12]);
  });
});

describe("V2 rejected command rendering", () => {
  it("shows server rejection text supplied by the transport", () => {
    const html = renderToStaticMarkup(<V2MatchBoard state={state(projection())}
      transportError="Duel resources: insufficient Energy" onCommand={async () => {
        throw new Error("ignored");
      }} />);
    expect(html).toContain("Duel resources: insufficient Energy");
    expect(html).toContain("role=\"alert\"");
  });

  it("renders server-provided target candidates and their zone-entry identity", () => {
    const value = projection({
      status: "pending",
      choiceId: "target-choice",
      ownerPlayerId: "player-1",
      stateVersion: 9,
      kind: "select-objects",
      options: [{ id: "unit-1", label: "Rumble" }],
      min: 1,
      max: 1
    });
    value.objects[2] = { ...value.objects[2]!, zoneEntryId: 12 };
    const html = render(state(value));
    expect(html).toContain("服务端投影候选目标");
    expect(html).toContain("Rumble");
    expect(html).toContain("出牌");
  });

  it("shows room, session and server URL controls without a legacy projection", () => {
    const html = renderToStaticMarkup(<V2MatchBoard state={{
      ...createV2ClientState({ viewerPlayerId: null }), connectionStatus: "connected"
    }} serverUrl="ws://127.0.0.1:39500/ws" onServerUrlChange={() => undefined}
      onCommand={async () => {
        throw new Error("unused");
      }} />);
    expect(html).toContain("V2 服务地址");
    expect(html).toContain("创建 1v1 房间");
    expect(html).toContain("加入房间");
    expect(html).toContain("ws://127.0.0.1:39500/ws");
  });
});
