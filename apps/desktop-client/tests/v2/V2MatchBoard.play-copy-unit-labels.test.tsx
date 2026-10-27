import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { buildV2ChoiceAnswer, buildV2MoveCommand, V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type {
  V2PendingChoice,
  V2PlayOption,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";

const receipt = {
  type: "command-receipt" as const,
  protocolVersion: "2.0.0" as const,
  commandId: "rift-1097",
  stateVersion: 4,
  eventSeq: 2,
  accepted: true,
  duplicate: false,
  rejection: null
};

function forecaster(objectId: string, zoneEntryId: number, ownerPlayerId: string,
  location: V2ProjectedObject["location"], visibility: V2ProjectedObject["visibility"] = "public"): V2ProjectedObject {
  return {
    objectId,
    zoneEntryId,
    zone: "board",
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    cardId: "forecaster",
    name: "Forecaster",
    faceDown: false,
    visibility,
    might: 2,
    location
  };
}

function projection(options: {
  readonly plays?: readonly V2PlayOption[];
  readonly pendingChoice?: V2PendingChoice;
  readonly objects?: readonly V2ProjectedObject[];
  readonly moves?: V2Projection["actionOptions"]["moves"];
  readonly combat?: V2Projection["combat"];
} = {}): V2Projection {
  const objects = options.objects ?? [];
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1097",
    viewerPlayerId: "player-1",
    stateVersion: 4,
    eventSeq: 2,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0,
        handCount: 2, deckCount: 20, runeDeckCount: 10, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "royal-guard", zone: "hand", ownerPlayerId: "player-1", cardId: "royal-guard",
        name: "Royal Guard", faceDown: false, visibility: "owner-only" },
      { objectId: "field-1", zone: "board", ownerPlayerId: "player-1", cardId: "field",
        name: "Treasure Hoard", faceDown: false, visibility: "public" },
      ...objects
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "player-1", contestedByPlayerId: null,
      staged: options.combat?.status === "active" ? "combat" : "none", occupantObjectIds: objects.map(object => object.objectId) }],
    combat: options.combat ?? { status: "none" },
    actionOptions: {
      canEndTurn: true,
      canAdvance: false,
      canPass: true,
      moves: options.moves ?? [],
      plays: options.plays ?? []
    },
    pendingChoice: options.pendingChoice ?? { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0 })
  };
}

function render(value: V2Projection, selectedCardId: string | null = "royal-guard",
  onCommand = vi.fn(async () => receipt)): string {
  return renderToStaticMarkup(<V2MatchBoard state={state(value)} initialSelectedCardId={selectedCardId}
    onCommand={onCommand} />);
}

function playPanel(markup: string): string {
  const start = markup.indexOf('aria-label="出牌目标"');
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</section>", start));
}

function choicePanel(markup: string): string {
  const start = markup.indexOf('aria-label="选择请求"');
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</section>", start));
}

function movePanel(markup: string): string {
  const start = markup.indexOf('aria-label="移动操作"');
  expect(start).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</section>", start));
}

describe("RIFT-1097 V2 play target copy", () => {
  it("shows the projected target requirement when candidates are available", () => {
    const targetAtField = forecaster("target-field", 11, "player-2", { kind: "battlefield", battlefieldId: "field-1" });
    const targetAtBase = forecaster("target-base", 12, "player-2", { kind: "base", playerId: "player-2" });
    const markup = render(projection({
      objects: [targetAtField, targetAtBase],
      plays: [{
        cardObjectId: "royal-guard",
        destination: { kind: "base", playerId: "player-1" },
        requiresDestination: false,
        targetRequirements: [{ id: "enemy-unit", label: "敌方单位", kind: "object", min: 1, max: 1,
          options: [
            { id: "target-field", label: "Forecaster", objectRef: { objectId: "target-field", zoneEntryId: 11 } },
            { id: "target-base", label: "Forecaster", objectRef: { objectId: "target-base", zoneEntryId: 12 } }
          ] }]
      }]
    }));
    const panel = playPanel(markup);
    expect(panel).toContain('aria-label="服务端投影出牌目标要求"');
    expect(panel).toContain("Forecaster · Treasure Hoard");
    expect(panel).toContain("Forecaster · Bob 的基地");
    expect(panel).not.toContain("此牌不需要目标。");
    expect(panel).not.toContain("服务端未公布该次出牌的目标候选。");
  });

  it("says an authorized option without targets needs no target", () => {
    const panel = playPanel(render(projection({
      plays: [{ cardObjectId: "royal-guard", destination: { kind: "base", playerId: "player-1" },
        requiresDestination: false }]
    })));
    expect(panel).toContain("此牌不需要目标。");
    expect(panel).not.toContain("服务端未公布该次出牌的目标要求。");
    expect(panel).not.toContain("服务端未公布该次出牌的目标候选。");
    expect(panel).not.toContain('aria-label="服务端投影出牌目标要求"');
  });

  it("reports missing candidates only when the projection has opened an object choice", () => {
    const panel = playPanel(render(projection({
      plays: [{ cardObjectId: "royal-guard", destination: { kind: "base", playerId: "player-1" },
        requiresDestination: false }],
      pendingChoice: { status: "pending", choiceId: "target:royal-guard", ownerPlayerId: "player-1",
        stateVersion: 4, kind: "select-objects", min: 1, max: 1 }
    })));
    expect(panel).toContain("服务端未公布该次出牌的目标候选。");
    expect(panel).not.toContain("此牌不需要目标。");
    expect(panel).not.toContain("服务端未公布该次出牌的目标要求。");
  });

  it("keeps targetless copy for a selected card whose projected choice is not a target choice", () => {
    const panel = playPanel(render(projection({
      plays: [{ cardObjectId: "royal-guard", destination: { kind: "base", playerId: "player-1" },
        requiresDestination: false }],
      pendingChoice: { status: "pending", choiceId: "royal-guard:mode", ownerPlayerId: "player-1",
        stateVersion: 4, kind: "mode", options: [{ id: "token", label: "Play Sand Soldier" }] }
    })));
    expect(panel).toContain("此牌不需要目标。");
    expect(panel).not.toContain("服务端未公布该次出牌的目标要求。");
  });
});

describe("RIFT-1097 V2 duplicate unit labels", () => {
  it("adds public locations to repeated names in the move and choice lists", () => {
    const atBase = forecaster("forecaster-base", 21, "player-1", { kind: "base", playerId: "player-1" });
    const atField = forecaster("forecaster-field", 22, "player-1", { kind: "battlefield", battlefieldId: "field-1" });
    const pendingChoice: V2PendingChoice = {
      status: "pending", choiceId: "choose-forecaster", ownerPlayerId: "player-1", stateVersion: 4,
      kind: "select-objects", min: 1, max: 1,
      options: [
        { id: "forecaster-base", label: "Forecaster", objectRef: { objectId: "forecaster-base", zoneEntryId: 21 } },
        { id: "forecaster-field", label: "Forecaster", objectRef: { objectId: "forecaster-field", zoneEntryId: 22 } }
      ]
    };
    const onCommand = vi.fn(async () => receipt);
    const markup = render(projection({
      objects: [atBase, atField],
      moves: [
        { objectId: "forecaster-base", destination: { kind: "battlefield", battlefieldId: "field-1" } },
        { objectId: "forecaster-field", destination: { kind: "base", playerId: "player-1" } }
      ],
      pendingChoice
    }), null, onCommand);
    for (const label of ["Forecaster · 我的基地", "Forecaster · Treasure Hoard"]) {
      expect(movePanel(markup)).toContain(label);
      expect(choicePanel(markup)).toContain(label);
    }
    expect(buildV2ChoiceAnswer(pendingChoice, ["forecaster-field"], ""))
      .toEqual([{ objectId: "forecaster-field", zoneEntryId: 22 }]);
    expect(buildV2MoveCommand("forecaster-field", { kind: "base", playerId: "player-1" }))
      .toEqual({ type: "move", objectId: "forecaster-field", to: { zone: "base", playerId: "player-1" } });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("numbers repeated names at the same location in damage and choice lists", () => {
    const first = forecaster("enemy-1", 31, "player-2", { kind: "battlefield", battlefieldId: "field-1" });
    const second = forecaster("enemy-2", 32, "player-2", { kind: "battlefield", battlefieldId: "field-1" });
    const pendingChoice: V2PendingChoice = {
      status: "pending", choiceId: "choose-enemy", ownerPlayerId: "player-1", stateVersion: 4,
      kind: "select-objects", min: 1, max: 1,
      options: [
        { id: "enemy-1", label: "Forecaster", objectRef: { objectId: "enemy-1", zoneEntryId: 31 } },
        { id: "enemy-2", label: "Forecaster", objectRef: { objectId: "enemy-2", zoneEntryId: 32 } }
      ]
    };
    const markup = render(projection({
      objects: [first, second],
      pendingChoice,
      combat: { status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1",
        attackerPlayerId: "player-1", defenderPlayerId: "player-2",
        damage: { attackerMight: 4, defenderMight: 4, attackerSubmitted: false, expectedPlayerId: "player-1" } }
    }), null);
    const damage = markup.slice(markup.indexOf('aria-label="战斗伤害分配"'), markup.indexOf("提交战斗伤害"));
    for (const label of ["Forecaster · Treasure Hoard #1", "Forecaster · Treasure Hoard #2"]) {
      expect(damage).toContain(label);
      expect(choicePanel(markup)).toContain(label);
    }
  });

  it("does not reveal locations for owner-only duplicates", () => {
    const hiddenAtBase = forecaster("private-base", 41, "player-1", { kind: "base", playerId: "player-1" }, "owner-only");
    const hiddenAtField = forecaster("private-field", 42, "player-1",
      { kind: "battlefield", battlefieldId: "field-1" }, "owner-only");
    const markup = render(projection({
      objects: [hiddenAtBase, hiddenAtField],
      moves: [
        { objectId: "private-base", destination: { kind: "battlefield", battlefieldId: "field-1" } },
        { objectId: "private-field", destination: { kind: "base", playerId: "player-1" } }
      ]
    }), null);
    const panel = movePanel(markup);
    expect(panel).toContain("Forecaster · 位置未明 #1");
    expect(panel).toContain("Forecaster · 位置未明 #2");
    expect(panel).not.toContain("Forecaster · 我的基地");
    expect(panel).not.toContain("Forecaster · Treasure Hoard");
  });
});
