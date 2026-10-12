import { describe, expect, it } from "vitest";
import {
  acceptConfirmedProjection,
  advanceResumeCursor,
  buildCommandTargets,
  buildPlayableCommand,
  buildPlayableMatchView,
  buildResumeCursor,
  isFullProductRuleset,
  sanitizeProjectionForViewer,
  toPlayableConnectionStatus
} from "../../src/full-product/transport";
import type { PlayableMatchView } from "../../src/full-product/types";
import type {
  GameProjection,
  ProjectionObject
} from "@riftbound/protocol";

describe("full-product transport", () => {
  it("only enables the playable board for the full-product ruleset", () => {
    expect(isFullProductRuleset("riftbound-foundation")).toBe(true);
    expect(isFullProductRuleset("synthetic-demo")).toBe(false);
    expect(buildPlayableMatchView(makeInput({
      projection: makeProjection({ rulesetId: "synthetic-demo" })
    }))).toBeNull();
  });

  it("builds a view while hiding opponent private data and preserving own playable ids", () => {
    const view = buildPlayableMatchView(makeInput({
      projection: makeProjection({ includeOpponentSecrets: true })
    }));
    expect(view).not.toBeNull();
    const opponent = view!.projection.players.find(
      player => player.id === "player-2"
    );
    expect(opponent?.hand).toEqual([]);
    expect(opponent?.playableInstanceIds).toEqual([]);
    expect(
      view!.projection.objects?.some(object => object.objectId === "opponent-secret")
    ).toBe(false);
    expect(
      view!.projection.players.find(player => player.id === "player-1")
        ?.playableInstanceIds
    ).toEqual(["self-hand-1"]);
  });

  it("filters target options that reference hidden objects or unknown players", () => {
    const view = buildPlayableMatchView(makeInput({
      targets: {
        "self-card": [
          { id: "visible", label: "Visible", objectId: "opponent-unit" },
          { id: "hidden", label: "Hidden", objectId: "opponent-secret" },
          { id: "player", label: "Player", playerId: "player-2" },
          { id: "unknown", label: "Unknown", playerId: "player-3" }
        ]
      },
      targetRequirements: { "self-card": ["target"] }
    }));
    expect(view?.targets?.["self-card"]?.map(option => option.id)).toEqual([
      "visible",
      "player"
    ]);
  });

  it("maps selected targets to play-card command targets only on submission", () => {
    const view = buildPlayableMatchView(makeInput({
      targets: {
        "self-card": [
          { id: "object-target", label: "Unit", objectId: "opponent-unit" },
          { id: "player-target", label: "Player", playerId: "player-2" }
        ]
      },
      targetRequirements: { "self-card": ["target"] }
    }))!;
    const selection = {
      actionId: "play:self-hand-1",
      cardId: "self-hand-1",
      targetIds: ["object-target", "player-target"]
    };
    expect(buildPlayableCommand({ ...selection, targetIds: [] }, view)).toBeNull();
    expect(buildPlayableCommand(selection, view)).toEqual({
      type: "play-card",
      instanceId: "self-hand-1",
      targets: [
        { kind: "object", objectId: "opponent-unit" },
        { kind: "player", playerId: "player-2" }
      ]
    });
  });

  it("does not attach targets to commands that do not require them", () => {
    const view = buildPlayableMatchView(makeInput())!;
    expect(buildPlayableCommand({
      actionId: "play:self-hand-1",
      cardId: "self-hand-1",
      targetIds: []
    }, view)).toEqual({
      type: "play-card",
      instanceId: "self-hand-1",
      targets: undefined
    });
  });

  it("rejects invalid selections before producing a command", () => {
    const view = buildPlayableMatchView(makeInput({
      targets: { "self-card": [{ id: "target-1", label: "Target" }] },
      targetRequirements: { "self-card": ["target"] }
    }))!;
    expect(buildCommandTargets({
      cardId: "self-hand-1",
      targetIds: ["unknown"]
    }, view)).toBeNull();
    expect(buildPlayableCommand({
      actionId: "play:self-hand-1",
      cardId: "self-hand-1",
      targetIds: ["target-1", "target-1"]
    }, view)).toBeNull();
  });

  it("keeps the latest confirmed projection and advances resume cursors monotonically", () => {
    const confirmed = makeProjection();
    expect(acceptConfirmedProjection(confirmed, null)).toBeNull();
    expect(acceptConfirmedProjection(confirmed, makeProjection({ version: 1, eventSeq: 0 })))
      .toBe(confirmed);
    expect(acceptConfirmedProjection(confirmed, makeProjection({ version: 3, eventSeq: 4 })))
      .toMatchObject({ version: 3, eventSeq: 4 });

    const initial = buildResumeCursor({ eventSeq: 7, roomEventSeq: 3 });
    expect(initial).toEqual({ afterEventSeq: 7, afterRoomEventSeq: 3 });
    expect(advanceResumeCursor(initial, {
      afterEventSeq: 5,
      afterRoomEventSeq: 9
    })).toEqual({ afterEventSeq: 7, afterRoomEventSeq: 9 });
  });

  it("maps connection and pending state without exposing command retries to the board", () => {
    expect(toPlayableConnectionStatus("connected", true)).toBe("connected");
    expect(toPlayableConnectionStatus("connected", false)).toBe("connecting");
    expect(toPlayableConnectionStatus("reconnecting", false)).toBe("reconnecting");
    expect(toPlayableConnectionStatus("idle", false)).toBe("disconnected");
    expect(sanitizeProjectionForViewer(makeProjection(), "player-1")).toMatchObject({
      rulesetId: "riftbound-foundation"
    });
  });

  it("uses foundation server prompts for target choices without pre-guessing card targets", () => {
    const view = buildPlayableMatchView(makeInput({
      projection: makeProjection({
        prompt: {
          id: "prompt:target-choice",
          ownerPlayerId: "player-1",
          playerId: "player-1",
          stateVersion: 2,
          status: "pending",
          taskId: "task:effect",
          reason: "resolve-effect",
          optional: false,
          options: [{
            id: "target:object:opponent-unit",
            label: "Object opponent-unit"
          }]
        }
      })
    }))!;

    expect(view.projection.prompt).not.toBeNull();
    expect(buildPlayableCommand({
      actionId: "prompt:target-choice:target:object:opponent-unit",
      cardId: null,
      targetIds: []
    }, view)).toEqual({
      type: "respond-to-prompt",
      promptId: "prompt:target-choice",
      optionId: "target:object:opponent-unit",
      stateVersion: 2
    });
    expect(view.targets).toBeUndefined();
  });
});

interface TransportInputOverrides {
  readonly projection?: GameProjection;
  readonly targets?: Record<string, readonly TargetOptionOverride[]>;
  readonly targetRequirements?: Record<string, readonly string[]>;
}

type TargetOptionOverride = {
  readonly id: string;
  readonly label: string;
  readonly objectId?: string;
  readonly playerId?: string;
};

function makeInput(overrides: TransportInputOverrides = {}) {
  return {
    projection: overrides.projection ?? makeProjection(),
    viewerPlayerId: "player-1",
    connectionStatus: "connected" as const,
    commandPending: false,
    resolveCard: (cardId: string) => ({
      title: `Card ${cardId}`,
      imageUrl: null
    }),
    targets: overrides.targets,
    targetRequirements: overrides.targetRequirements
  };
}

function makeProjection(options: {
  readonly version?: number;
  readonly eventSeq?: number;
  readonly rulesetId?: string;
  readonly includeOpponentSecrets?: boolean;
  readonly prompt?: GameProjection["prompt"];
} = {}): GameProjection {
  const objects: ProjectionObject[] = [
    {
      objectId: "self-hand-1",
      cardId: "self-card",
      zone: "hand",
      controllerId: "player-1",
      ownerPlayerId: "player-1",
      faceUp: true
    },
    {
      objectId: "opponent-unit",
      cardId: "opponent-card",
      zone: "board",
      controllerId: "player-2",
      ownerPlayerId: "player-2",
      faceUp: true
    }
  ];
  if (options.includeOpponentSecrets === true) {
    objects.push({
      objectId: "opponent-secret",
      cardId: "secret-card",
      zone: "hand",
      controllerId: "player-2",
      ownerPlayerId: "player-2",
      faceUp: true
    });
  }
  return {
    projectionSchema: "riftbound.projection.v1",
    rulesetId: options.rulesetId ?? "riftbound-foundation",
    version: options.version ?? 2,
    eventSeq: options.eventSeq ?? 2,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    priority: { playerId: "player-1" },
    winnerPlayerId: null,
    prompt: options.prompt ?? null,
    waitingForPlayerId: options.prompt?.ownerPlayerId ?? null,
    players: [
      {
        id: "player-1",
        name: "Alice",
        handCount: 1,
        hand: [{ instanceId: "self-hand-1", cardId: "self-card" }],
        playableInstanceIds: ["self-hand-1"],
        zoneCounts: { hand: 1, board: 1 }
      },
      {
        id: "player-2",
        name: "Bob",
        handCount: 1,
        hand: [],
        playableInstanceIds: [],
        zoneCounts: { hand: 1, board: 1 }
      }
    ],
    objects,
    events: []
  };
}
