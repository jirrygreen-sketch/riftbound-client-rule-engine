import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  buildV2ChoiceAnswer,
  buildV2MulliganCommand,
  buildV2PassCommand,
  buildV2PlayCommand,
  V2MatchBoard
} from "../../src/full-product/v2/V2MatchBoard";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

describe("protocol v2 match board", () => {
  it("renders hand play actions and uses the projected object id", () => {
    const html = render(makeState({ phase: "main" }));
    expect(html).toContain("打出 云雀斥候");
    expect(buildV2PlayCommand("hand-card")).toEqual({ type: "play", cardObjectId: "hand-card" });
  });

  it("renders startup/mulligan controls from the setup projection", () => {
    const html = render(makeState({ phase: "setup" }));
    expect(html).toContain("启动");
    expect(html).toContain("确认起手（调度 0 张）");
    expect(buildV2MulliganCommand(["hand-card"])).toEqual({ type: "mulligan", selectedObjectIds: ["hand-card"] });
  });

  it("renders pass only from the v2 priority surface", () => {
    const html = render(makeState({ phase: "main" }));
    expect(html).toContain(">Pass</button>");
    expect(buildV2PassCommand()).toEqual({ type: "pass" });
  });

  it("renders owner-only response choices and builds a legal choose answer", () => {
    const projection = makeProjection({
      phase: "main",
      pendingChoice: {
        status: "pending",
        choiceId: "choice-1",
        ownerPlayerId: "alice",
        stateVersion: 4,
        kind: "mode",
        options: [{ id: "accept", label: "回应" }]
      }
    });
    const state = withProjection(projection);
    const html = renderState({
      ...state,
      choice: createV2ChoiceUiState(projection.pendingChoice, { viewerPlayerId: "alice", now: 1, timeoutMs: 10_000 })
    });
    expect(html).toContain("选择请求");
    expect(html).toContain("回应");
    expect(buildV2ChoiceAnswer(projection.pendingChoice, ["accept"], "")).toBe("accept");
  });

  it("maps target/pick selections, optional modes, and ordered picks without local rules", () => {
    const targetChoice = {
      status: "pending" as const,
      choiceId: "targets",
      ownerPlayerId: "alice",
      stateVersion: 5,
      kind: "select-objects" as const,
      options: [{ id: "unit-1", label: "战场单位" }],
      min: 1,
      max: 1
    };
    expect(buildV2ChoiceAnswer(targetChoice, ["unit-1"], "")).toEqual([{ objectId: "unit-1" }]);

    const orderChoice = {
      ...targetChoice,
      choiceId: "order",
      kind: "order" as const,
      options: [
        { id: "first", label: "第一张", value: "first" },
        { id: "second", label: "第二张", value: "second" }
      ],
      min: 2,
      max: 2
    };
    expect(buildV2ChoiceAnswer(orderChoice, ["second", "first"], "")).toEqual(["second", "first"]);

    const numberChoice = { ...targetChoice, kind: "number" as const, min: 1, max: 3 };
    expect(buildV2ChoiceAnswer(numberChoice, [], "2")).toBe(2);

    const optionalChoice = { ...targetChoice, kind: "optional" as const, options: undefined, min: undefined, max: undefined };
    expect(buildV2ChoiceAnswer(optionalChoice, [], "")).toBe(true);
  });

  it("keeps the last safe projection visible while reconnecting", () => {
    const state = withProjection(makeProjection({ phase: "combat" }));
    const html = renderState({ ...state, connectionStatus: "reconnecting" });
    expect(html).toContain("重连中");
    expect(html).toContain("我的手牌");
    expect(html).toContain("战场");
  });
});

function render(state: V2ClientState): string {
  return renderState(state);
}

function renderState(state: V2ClientState): string {
  return renderToStaticMarkup(<V2MatchBoard state={state} onCommand={async () => ({
    type: "command-receipt",
    protocolVersion: "2.0.0",
    commandId: "test",
    stateVersion: 1,
    eventSeq: 1,
    accepted: true,
    duplicate: false,
    rejection: null
  })} />);
}

function withProjection(projection: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0 }),
    projection,
    stateVersion: projection.stateVersion,
    eventSeq: projection.eventSeq
  };
}

function makeState(overrides: Partial<Pick<V2Projection, "phase" | "pendingChoice">>): V2ClientState {
  return withProjection(makeProjection(overrides));
}

function makeProjection(overrides: Partial<Pick<V2Projection, "phase" | "pendingChoice">> = {}): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-1",
    viewerPlayerId: "alice",
    stateVersion: 3,
    eventSeq: 2,
    phase: overrides.phase ?? "main",
    turnNumber: 1,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 2, power: { any: 1 }, xp: 0, handCount: 1, deckCount: 20, runeDeckCount: 12, zoneCounts: { "rune-zone": 1 } },
      { playerId: "bob", name: "Bob", score: 0, energy: 1, power: { any: 0 }, xp: 0, handCount: 4, deckCount: 19, runeDeckCount: 12, zoneCounts: {} }
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "alice", count: 1, objects: [{ objectId: "hand-card", zone: "hand", ownerPlayerId: "alice", cardId: "bird", name: "云雀斥候", faceDown: false, visibility: "owner-only" }] },
      { zone: "hand", ownerPlayerId: "bob", count: 4 },
      { zone: "rune-zone", ownerPlayerId: "alice", count: 1, objects: [{ objectId: "rune-1", zone: "rune-zone", ownerPlayerId: "alice", cardId: "rune", name: "符文", faceDown: false, visibility: "public" }] }
    ],
    objects: [
      { objectId: "hand-card", zone: "hand", ownerPlayerId: "alice", cardId: "bird", name: "云雀斥候", faceDown: false, visibility: "owner-only" },
      { objectId: "rune-1", zone: "rune-zone", ownerPlayerId: "alice", cardId: "rune", name: "符文", faceDown: false, visibility: "public" },
      { objectId: "unit-1", zone: "battlefield", ownerPlayerId: "alice", controllerPlayerId: "alice", cardId: "unit", name: "战场单位", faceDown: false, visibility: "public", location: { kind: "battlefield", battlefieldId: "field-1" } }
    ],
    chain: { status: "open", phase: "open", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [{ playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }, { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }] },
    pendingChoice: overrides.pendingChoice ?? { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}
