import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

function projection(source: { readonly objectId?: string; readonly name?: string } | undefined,
  prompt: string | undefined): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1069-choice-source",
    viewerPlayerId: "alice",
    stateVersion: 4,
    eventSeq: 3,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
    ],
    zones: [],
    objects: [],
    chain: { status: "open", phase: "await-commit", priorityPlayerId: null, focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "choice" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      ],
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    pendingChoice: {
      status: "pending",
      choiceId: "finalize:trigger:1:optional",
      ownerPlayerId: "alice",
      stateVersion: 4,
      kind: "optional",
      ...(prompt === undefined ? {} : { prompt }),
      ...(source === undefined ? {} : { source }),
    },
    winnerPlayerId: null,
    events: [],
  };
}

function render(value: V2Projection): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 }),
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} onCommand={async () => ({
    type: "command-receipt",
    protocolVersion: "2.0.0",
    commandId: "test",
    stateVersion: 5,
    eventSeq: 4,
    accepted: true,
    duplicate: false,
    rejection: null,
  })} />);
}

describe("V2 choice source and prompt", () => {
  it("renders the source name and engine prompt under the choice heading", () => {
    const html = render(projection({ objectId: "source-1", name: "Treasure Hoard" }, "Pay 1 Energy?"));
    expect(html).toContain("来源：Treasure Hoard");
    expect(html).toContain("Pay 1 Energy?");
  });

  it("keeps the original choice panel when auxiliary metadata is absent", () => {
    const html = render(projection(undefined, undefined));
    expect(html).toContain("选择请求 · 可选效果");
    expect(html).not.toContain("来源：");
  });

  it("does not render a hidden identity or prompt when only the redacted source id is present", () => {
    const html = render(projection({ objectId: "hidden:source" }, undefined));
    expect(html).not.toContain("来源：");
    expect(html).not.toContain("hidden:source");
  });
});
