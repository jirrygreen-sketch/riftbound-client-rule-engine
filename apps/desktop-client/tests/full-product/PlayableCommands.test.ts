import { describe, expect, it } from "vitest";
import {
  buildSubmissionFromSelection,
  deriveLegalActions,
  isViewerCommandAllowed
} from "../../src/full-product/commands";
import type { PlayableMatchView } from "../../src/full-product/types";
import type { GameProjection } from "@riftbound/protocol";

describe("full-product playable command model", () => {
  it("derives legal actions from authority instead of card clicks", () => {
    const view = makeView({ playable: ["hand-1"] });
    const actions = deriveLegalActions(view);

    expect(actions.map(action => action.type)).toEqual(["pass", "play-card"]);
    expect(actions[1]).toMatchObject({
      id: "play:hand-1",
      disabled: false,
      command: { type: "play-card", instanceId: "hand-1" }
    });
  });

  it("requires prompt selection and sends the prompt command only on submit", () => {
    const view = makeView({
      promptOwner: "player-1",
      promptOptionStates: {
        "prompt-1": { blocked: { disabled: true, reason: "条件未满足" } }
      }
    });
    const actions = deriveLegalActions(view);
    expect(actions.map(action => action.type)).toEqual([
      "pass",
      "respond-to-prompt",
      "respond-to-prompt"
    ]);
    expect(actions[0]).toMatchObject({
      disabled: true,
      ready: false,
      reason: "请先完成当前选择"
    });
    const action = deriveLegalActions(view).find(
      candidate => candidate.id === "prompt-1:resolve"
    );
    expect(action).toMatchObject({ ready: true });
    expect(buildSubmissionFromSelection({ actionId: null, cardId: null, targetIds: [] }, view)).toBeNull();
    expect(buildSubmissionFromSelection({ actionId: "prompt-1:resolve", cardId: null, targetIds: [] }, view)).toEqual({
      type: "respond-to-prompt",
      promptId: "prompt-1",
      optionId: "resolve",
      stateVersion: 1
    });
  });

  it("marks target-dependent play actions unavailable until targets are selected", () => {
    const view = makeView({ playable: ["hand-1"], requirements: { "card-1": ["target"] } });
    const actions = deriveLegalActions(view);
    expect(actions[1]).toMatchObject({
      ready: false,
      reason: "请先选择目标",
      requiresTargets: true
    });
    expect(buildSubmissionFromSelection({ actionId: "play:hand-1", cardId: "hand-1", targetIds: [] }, view)).toBeNull();
    expect(buildSubmissionFromSelection({ actionId: "play:hand-1", cardId: "hand-1", targetIds: ["target-1"] }, view)).toEqual({
      type: "play-card",
      instanceId: "hand-1"
    });
  });

  it("requires the selected card to match the selected authority-derived action", () => {
    const view = makeView({ playable: ["hand-1"] });
    expect(buildSubmissionFromSelection({
      actionId: "play:hand-1",
      cardId: "hand-2",
      targetIds: []
    }, view)).toBeNull();
  });

  it("keeps the board read-only while disconnected or while a command is pending", () => {
    expect(isViewerCommandAllowed(makeView({ status: "disconnected" }))).toBe(false);
    expect(isViewerCommandAllowed(makeView({ pending: true }))).toBe(false);
    const disconnected = deriveLegalActions(makeView({ status: "disconnected" }));
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toMatchObject({
      disabled: true,
      reason: "断线只读"
    });
  });

  it("rejects disabled and unknown target selections before submitting", () => {
    const view = makeView({
      playable: ["hand-1"],
      requirements: { "card-1": ["target"] },
      targets: {
        "card-1": [
          { id: "target-1", label: "target one" },
          { id: "target-disabled", label: "disabled target", disabled: true }
        ]
      }
    });
    expect(buildSubmissionFromSelection({
      actionId: "play:hand-1",
      cardId: "hand-1",
      targetIds: ["target-disabled"]
    }, view)).toBeNull();
    expect(buildSubmissionFromSelection({
      actionId: "play:hand-1",
      cardId: "hand-1",
      targetIds: ["unknown"]
    }, view)).toBeNull();
    expect(buildSubmissionFromSelection({
      actionId: "play:hand-1",
      cardId: "hand-1",
      targetIds: ["target-1", "target-1"]
    }, view)).toBeNull();
  });

  it("does not expose the opponent prompt as a viewer action", () => {
    const view = makeView({ promptOwner: "player-2" });
    expect(isViewerCommandAllowed(view)).toBe(false);
    expect(deriveLegalActions(view)[0]?.reason).toContain("等待 Bob 选择");
  });

  it("keeps server-disabled prompt options unavailable", () => {
    const view = makeView({
      promptOwner: "player-1",
      promptOptionStates: {
        "prompt-1": { blocked: { disabled: true, reason: "条件未满足" } }
      }
    });
    const blocked = deriveLegalActions(view).find(
      action => action.id === "prompt-1:blocked"
    );
    expect(blocked).toMatchObject({
      disabled: true,
      ready: false,
      reason: "条件未满足"
    });
    expect(buildSubmissionFromSelection({
      actionId: "prompt-1:blocked",
      cardId: null,
      targetIds: []
    }, view)).toBeNull();
  });
});

function makeView({
  status = "connected",
  pending = false,
  playable = [],
  promptOwner = null,
  requirements = {},
  targets,
  promptOptionStates
}: {
  status?: PlayableMatchView["connectionStatus"];
  pending?: boolean;
  playable?: readonly string[];
  promptOwner?: string | null;
  requirements?: Record<string, readonly string[]>;
  promptOptionStates?: PlayableMatchView["promptOptionStates"];
  targets?: Readonly<Record<string, readonly {
    readonly id: string;
    readonly label: string;
    readonly disabled?: boolean;
  }[]>>;
}): PlayableMatchView {
  return {
    connectionStatus: status,
    commandPending: pending,
    viewerPlayerId: "player-1",
    resolveCardTitle: cardId => `Card ${cardId}`,
    resolveCardImage: () => null,
    targetRequirements: requirements,
    targets: targets ?? {
      "card-1": [{ id: "target-1", label: "target one" }]
    },
    promptOptionStates,
    projection: makeProjection({ playable, promptOwner })
  };
}

function makeProjection({
  playable,
  promptOwner
}: {
  playable: readonly string[];
  promptOwner: string | null;
}): GameProjection {
  return {
    version: 1,
    eventSeq: 0,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: promptOwner
      ? {
          id: "prompt-1",
          ownerPlayerId: promptOwner,
          playerId: promptOwner,
          stateVersion: 1,
          status: "pending",
          taskId: "task-1",
          reason: "choose-target",
          optional: false,
          options: [
            { id: "resolve", label: "确认" },
            { id: "blocked", label: "不可选", disabled: true, reason: "条件未满足" }
          ]
        }
      : null,
    waitingForPlayerId: promptOwner,
    players: [
      {
        id: "player-1",
        name: "Alice",
        handCount: 1,
        hand: [{ instanceId: "hand-1", cardId: "card-1" }],
        playableInstanceIds: [...playable]
      },
      {
        id: "player-2",
        name: "Bob",
        handCount: 0,
        hand: [],
        playableInstanceIds: []
      }
    ],
    events: []
  };
}
