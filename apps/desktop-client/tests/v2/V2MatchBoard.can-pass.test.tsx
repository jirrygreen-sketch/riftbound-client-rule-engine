import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { commandErrorAfterReceipt, V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2CommandReceipt, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

function projection(): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-rift-1081",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0,
        handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0,
        handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
    ],
    zones: [],
    objects: [],
    chain: { status: "open", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: null,
      contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, canPass: true, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: [],
  };
}

function state(value = projection()): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, {
      viewerPlayerId: "player-1", now: 0, timeoutMs: 10_000,
    }),
  };
}

function receipt(accepted: boolean): V2CommandReceipt {
  return { type: "command-receipt", protocolVersion: "2.0.0", commandId: "rift-1081",
    stateVersion: 9, eventSeq: 4, accepted, duplicate: false,
    rejection: accepted ? null : "Player cannot pass now" };
}

function render(value: V2ClientState): string {
  return renderToStaticMarkup(<V2MatchBoard state={value} onCommand={async () => receipt(true)} />);
}

function passButton(markup: string): string {
  const index = markup.indexOf(">Pass</button>");
  if (index < 0) throw new Error("Pass button missing");
  const start = markup.lastIndexOf("<button", index);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

describe("RIFT-1081 V2 Pass action projection", () => {
  it("disables Pass when the server explicitly rejects that action", () => {
    const value = projection();
    value.actionOptions = { ...value.actionOptions, canPass: false };
    const button = passButton(render(state(value)));
    expect(button).toContain('disabled=""');
  });

  it("keeps Pass enabled when the server explicitly allows it", () => {
    const button = passButton(render(state()));
    expect(button).not.toContain('disabled=""');
  });

  it("preserves the pre-field behavior for older server projections", () => {
    const value = projection();
    value.actionOptions = { canEndTurn: true, canAdvance: false, moves: [], plays: [] };
    const button = passButton(render(state(value)));
    expect(button).not.toContain('disabled=""');
  });

  it("preserves the legacy render when actionOptions itself is absent", () => {
    const value = projection() as V2Projection & { readonly actionOptions?: V2Projection["actionOptions"] };
    const { actionOptions: _, ...legacy } = value;
    const button = passButton(render(state(legacy as V2Projection)));
    expect(button).not.toContain('disabled=""');
  });

  it("shows the opponent-damage wait and disables Pass in the attacker view", () => {
    const value = projection();
    value.priority = { playerId: "player-1", focusPlayerId: null, window: "open" };
    value.combat = {
      status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1",
      attackerPlayerId: "player-1", defenderPlayerId: "player-2",
      damage: { attackerMight: 3, defenderMight: 2, attackerSubmitted: true, expectedPlayerId: "player-2" },
    };
    value.actionOptions = { ...value.actionOptions, canPass: false };
    const markup = render(state(value));
    expect(markup).toContain("等待对方分配伤害");
    expect(passButton(markup)).toContain('disabled=""');
  });

  it("keeps transport and state errors visible while only command errors are local", () => {
    const value = projection();
    value.actionOptions = { ...value.actionOptions, canPass: false };
    const transport = renderToStaticMarkup(
      <V2MatchBoard state={state(value)} transportError="socket closed" onCommand={async () => receipt(true)} />
    );
    expect(transport).toContain("socket closed");
    const stateError = renderToStaticMarkup(
      <V2MatchBoard state={{ ...state(value), lastError: "projection rejected" }}
        onCommand={async () => receipt(true)} />
    );
    expect(stateError).toContain("projection rejected");
  });

  it("clears only the local command error after command success", () => {
    expect(commandErrorAfterReceipt("Player cannot pass now", receipt(true))).toBeNull();
    expect(commandErrorAfterReceipt("Player cannot pass now", receipt(false))).toBe("Player cannot pass now");
  });

});
