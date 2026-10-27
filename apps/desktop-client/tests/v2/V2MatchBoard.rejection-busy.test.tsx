import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard, type V2MatchBoardProps } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2CommandReceipt, V2PendingChoice, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

const rejectedReceipt: V2CommandReceipt = {
  type: "command-receipt",
  protocolVersion: "2.0.0",
  commandId: "rejected-command",
  stateVersion: 10,
  eventSeq: 5,
  accepted: false,
  duplicate: false,
  rejection: "服务端仍在等待对手确认保留起手。",
};

function projection(pendingChoice: V2PendingChoice = { status: "none" }): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1102-busy",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 10, zoneCounts: { hand: 1 } },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0,
        handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "player-1", count: 1, objects: [
        { objectId: "hand-card", zoneEntryId: 1, zone: "hand", ownerPlayerId: "player-1",
          cardId: "cloud-scout", name: "云雀斥候", faceDown: false, visibility: "owner-only" },
      ] },
    ],
    objects: [
      { objectId: "hand-card", zoneEntryId: 1, zone: "hand", ownerPlayerId: "player-1",
        cardId: "cloud-scout", name: "云雀斥候", faceDown: false, visibility: "owner-only" },
      { objectId: "unit-1", zoneEntryId: 2, zone: "base", ownerPlayerId: "player-1", controllerPlayerId: "player-1",
        cardId: "unit", name: "Rumble", faceDown: false, visibility: "public", location: { kind: "base", playerId: "player-1" } },
      { objectId: "enemy-1", zoneEntryId: 11, zone: "board", ownerPlayerId: "player-2",
        cardId: "enemy-1", name: "Enemy One", faceDown: false, visibility: "public", might: 3,
        location: { kind: "battlefield", battlefieldId: "field-1" } },
      { objectId: "enemy-2", zoneEntryId: 12, zone: "board", ownerPlayerId: "player-2",
        cardId: "enemy-2", name: "Enemy Two", faceDown: false, visibility: "public", might: 2,
        location: { kind: "battlefield", battlefieldId: "field-1" } },
    ],
    chain: { status: "open", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "player-2", contestedByPlayerId: "player-1",
      staged: "combat", occupantObjectIds: ["enemy-1", "enemy-2"] }],
    combat: { status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1",
      attackerPlayerId: "player-1", defenderPlayerId: "player-2",
      damage: { attackerMight: 5, defenderMight: 4, attackerSubmitted: false, expectedPlayerId: "player-1" } },
    actionOptions: {
      canEndTurn: true,
      canAdvance: true,
      canPass: true,
      moves: [{ objectId: "unit-1", destination: { kind: "battlefield", battlefieldId: "field-1" } }],
      plays: [{ cardObjectId: "hand-card", destination: { kind: "base", playerId: "player-1" },
        requiresDestination: false }],
    },
    pendingChoice,
    winnerPlayerId: null,
    events: [],
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 60_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, {
      viewerPlayerId: "player-1",
      now: 0,
      timeoutMs: 60_000,
    }),
  };
}

function render(value: V2Projection, overrides: Partial<V2MatchBoardProps> = {}): string {
  return renderToStaticMarkup(<V2MatchBoard
    state={state(value)}
    initialSelectedCardId="hand-card"
    initialCombatDamageDrafts={{ "enemy-1": "3", "enemy-2": "2" }}
    initialConcedeConfirmationOpen
    onCommand={async () => ({ ...rejectedReceipt, accepted: true, rejection: null })}
    {...overrides}
  />);
}

function buttonTag(markup: string, label: string): string {
  const index = markup.indexOf(`>${label}</button>`);
  if (index < 0) throw new Error(`button missing: ${label}`);
  const start = markup.lastIndexOf("<button", index);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

function optionalChoice(): V2PendingChoice {
  return {
    status: "pending",
    choiceId: "choice-1",
    ownerPlayerId: "player-1",
    stateVersion: 9,
    kind: "optional",
  };
}

describe("RIFT-1102 V2 command rejection and pending state", () => {
  it("shows the rejected receipt reason without swallowing independent errors", () => {
    const value = projection();
    const markup = render(value, {
      lastReceipt: rejectedReceipt,
      transportError: "WebSocket 已断开。",
      state: { ...state(value), lastError: "投影状态过期。" },
      pendingCommandIds: [],
    });

    expect(markup).toContain("命令 rejected-command 未执行");
    expect(markup).toContain("服务端仍在等待对手确认保留起手。");
    expect(markup).toContain("WebSocket 已断开。");
    expect(markup).toContain("投影状态过期。");
  });

  it("gives a visible fallback when a rejected receipt has no rejection text", () => {
    const markup = render(projection(), {
      lastReceipt: { ...rejectedReceipt, rejection: null },
    });

    expect(markup).toContain("命令 rejected-command 未执行：服务端未提供拒绝原因。");
  });

  it("shows prominent processing feedback and disables every main command control while pending", () => {
    const markup = render(projection(), { pendingCommandIds: ["command-1"] });

    expect(markup).toContain('aria-label="命令处理中"');
    expect(markup).toContain("正在处理…");
    for (const label of ["打出手牌", "Pass", "结束回合", "推进", "提交战斗伤害", "确认认输"]) {
      expect(buttonTag(markup, label)).toContain('disabled=""');
    }
  });

  it("disables the move submission while pending", () => {
    const markup = render(projection(), { pendingCommandIds: ["command-1"] });
    expect(buttonTag(markup, "移动单位")).toContain('disabled=""');
  });

  it("disables mulligan and projected choice submission while a command is pending", () => {
    const setup = projection();
    setup.phase = "setup";
    setup.priority = { playerId: null, focusPlayerId: null, window: "choice" };
    setup.pendingChoice = {
      status: "pending",
      choiceId: "mulligan:player-1",
      ownerPlayerId: "player-1",
      stateVersion: 9,
      kind: "select-objects",
      options: [],
      min: 0,
      max: 2,
    };
    const setupMarkup = render(setup, { pendingCommandIds: ["mulligan-command"] });
    expect(buttonTag(setupMarkup, "保留起手")).toContain('disabled=""');

    const choiceMarkup = render(projection(optionalChoice()), { pendingCommandIds: ["choice-command"] });
    expect(buttonTag(choiceMarkup, "提交选择")).toContain('disabled=""');
  });
});
