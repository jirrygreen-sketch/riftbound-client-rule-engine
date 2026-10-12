import { describe, expect, it } from "vitest";
import type { RoomDeckSubmission } from "@riftbound/protocol";
import { FULL_PRODUCT_EVENT_CONTRACT } from "@riftbound/protocol/full-product";
import {
  FullProductOrchestrationError,
  FullProductRoomOrchestrator,
  type FullProductClientCommand,
  type FullProductCommandReceipt,
  type FullProductConnection,
  type FullProductDeckValidator,
  type FullProductLegalAction,
  type FullProductMatchResult,
  type FullProductMatchSummary,
  type FullProductReplayState,
  type FullProductRulesRuntime
} from "../../src/full-product/index.js";

interface TestPlayer {
  readonly id: "player-1" | "player-2";
  name: string;
  hand: readonly { instanceId: string; cardId: string }[];
}

interface TestState {
  summary: FullProductMatchSummary;
  players: TestPlayer[];
  prompt: {
    promptId: string;
    ownerPlayerId: string;
    stateVersion: number;
    optional: boolean;
    targetPolicy: {
      minTargets: number;
      maxTargets: number;
      allowedZones: readonly string[];
    };
    options: readonly { optionId: string; label: string }[];
  } | null;
}

const legalDeck: RoomDeckSubmission = { mainDeck: [] };

function validateDeck(deck: RoomDeckSubmission) {
  const valid = Array.isArray(deck.mainDeck);
  return valid
    ? { valid: true, issues: [] }
    : { valid: false, issues: ["mainDeck is required"] };
}

class TestRuntime implements FullProductRulesRuntime {
  private readonly authorityMarker = Symbol("test-runtime-authority");
  private state: TestState | null = null;
  private currentSnapshot: ReturnType<TestRuntime["snapshot"]> | null = null;
  private readonly eventLog: {
    eventContract: string;
    type: string;
    seq: number;
    turnNumber: number;
    activePlayerId: string;
    priorityPlayerId: string;
    playerIds: ["player-1", "player-2"];
    rulesetId: string;
  }[] = [];
  readonly submittedCommands: FullProductClientCommand[] = [];

  createMatch(config: Parameters<FullProductRulesRuntime["createMatch"]>[0]) {
    if (config.seats.length !== 2) {
      throw new Error("Two seats are required");
    }
    this.state = {
      summary: {
        version: 1,
        eventSeq: 1,
        phase: "main",
        turnNumber: 1,
        activePlayerId: config.firstPlayerId,
        priorityPlayerId: config.firstPlayerId,
        winnerPlayerId: null,
        waitingForPlayerId: null
      },
      players: [
        {
          id: "player-1",
          name: config.seats[0]?.name ?? "player-1",
          hand: [{ instanceId: "alice-card", cardId: "fixture.card" }]
        },
        {
          id: "player-2",
          name: config.seats[1]?.name ?? "player-2",
          hand: [{ instanceId: "bob-card", cardId: "fixture.card" }]
        }
      ],
      prompt: {
        promptId: "prompt-1",
        ownerPlayerId: "player-1",
        stateVersion: 1,
        optional: false,
        targetPolicy: {
          minTargets: 0,
          maxTargets: 0,
          allowedZones: []
        },
        options: [{ optionId: "ready", label: "Ready" }]
      }
    };
    this.eventLog.push({
      eventContract: FULL_PRODUCT_EVENT_CONTRACT,
      type: "game-started",
      seq: 1,
      turnNumber: 1,
      activePlayerId: config.firstPlayerId,
      priorityPlayerId: config.firstPlayerId,
      playerIds: ["player-1", "player-2"],
      rulesetId: "riftbound-full-product"
    });
    this.currentSnapshot = null;
    return { snapshot: this.snapshot() };
  }

  submitCommand(
    snapshot: Parameters<FullProductRulesRuntime["submitCommand"]>[0],
    command: Parameters<FullProductRulesRuntime["submitCommand"]>[1]
  ) {
    this.requireSnapshot(snapshot);
    this.submittedCommands.push(command);
    if (!this.state) throw new Error("The match is missing");

    if (command.type === "concede") {
      const winner = this.state.players.find(player =>
        player.id !== command.playerId
      );
      if (!winner) {
        return {
          snapshot,
          error: { code: "invalid_command", message: "No winner is available" }
        };
      }
      this.state.summary = {
        ...this.state.summary,
        version: this.state.summary.version + 1,
        eventSeq: this.state.summary.eventSeq + 1,
        phase: "ended",
        winnerPlayerId: winner.id,
        waitingForPlayerId: null
      };
      this.state.prompt = null;
      this.currentSnapshot = null;
      return { snapshot: this.snapshot(), error: null };
    }

    if (command.type !== "pass") {
      return {
        snapshot,
        error: { code: "invalid_command", message: "Unsupported command" }
      };
    }

    const active = this.state.players.find(player =>
      player.id === this.state?.summary.activePlayerId
    );
    const next = this.state.players.find(player => player.id !== active?.id);
    if (!active || !next) {
      return {
        snapshot,
        error: { code: "invalid_command", message: "Invalid players" }
      };
    }
    this.state.summary = {
      ...this.state.summary,
      version: this.state.summary.version + 1,
      eventSeq: this.state.summary.eventSeq + 1,
      activePlayerId: next.id,
      priorityPlayerId: next.id
    };
    this.eventLog.push({
      eventContract: FULL_PRODUCT_EVENT_CONTRACT,
      type: "priority-passed",
      seq: this.state.summary.eventSeq,
      turnNumber: this.state.summary.turnNumber,
      activePlayerId: next.id,
      priorityPlayerId: next.id,
      playerId: active.id,
      playerIds: ["player-1", "player-2"],
      rulesetId: "riftbound-full-product"
    });
    this.currentSnapshot = null;
    return { snapshot: this.snapshot(), error: null };
  }

  listLegalActions(
    snapshot: Parameters<FullProductRulesRuntime["listLegalActions"]>[0],
    playerId: Parameters<FullProductRulesRuntime["listLegalActions"]>[1]
  ): readonly FullProductLegalAction[] {
    this.requireSnapshot(snapshot);
    if (this.state?.summary.activePlayerId !== playerId) return [];
    return [{ type: "pass", playerId }];
  }

  project(
    snapshot: Parameters<FullProductRulesRuntime["project"]>[0],
    viewerPlayerId: Parameters<FullProductRulesRuntime["project"]>[1]
  ) {
    this.requireSnapshot(snapshot);
    if (!this.state) throw new Error("The match is missing");

    return {
      summary: { ...this.state.summary },
      prompt: this.state.prompt ? { ...this.state.prompt } : null,
      players: this.state.players.map(player => ({
        id: player.id,
        name: player.name,
        score: 0,
        energy: 0,
        handCount: player.hand.length,
        hand: viewerPlayerId === player.id ? player.hand : [],
        playableInstanceIds:
          viewerPlayerId === player.id
            ? player.hand.map(card => card.instanceId)
            : []
      })),
      objects: this.state.players.flatMap(player => [
        {
          objectId: `${player.id}-board`,
          cardId: "fixture.card",
          zone: "board",
          controllerId: player.id,
          ownerPlayerId: player.id,
          faceUp: true,
          visibility: "public" as const
        },
        {
          objectId: `${player.id}-hand`,
          cardId: "fixture.card",
          zone: "hand",
          controllerId: player.id,
          ownerPlayerId: player.id,
          faceUp: true,
          visibility: "private" as const
        }
      ]),
      events: this.eventLog.map(event => ({
        ...event,
        privateRuntimeField: "must-not-escape"
      }))
    };
  }

  matchResult(
    snapshot: Parameters<FullProductRulesRuntime["matchResult"]>[0]
  ): FullProductMatchResult | null {
    this.requireSnapshot(snapshot);
    if (this.state?.summary.phase !== "ended") return null;
    return {
      winnerPlayerId: this.state.summary.winnerPlayerId,
      reason: "concession",
      finalVersion: this.state.summary.version,
      finalEventSeq: this.state.summary.eventSeq
    };
  }

  private snapshot() {
    if (this.currentSnapshot) return this.currentSnapshot;
    if (!this.state) throw new Error("The match is missing");
    return {
      summary: this.state.summary,
      authority: {
        __fullProductRuntimeAuthority: this.authorityMarker
      }
    } as const;
  }

  private requireSnapshot(snapshot: unknown): void {
    const marker = (snapshot as {
      authority?: { __fullProductRuntimeAuthority?: symbol };
    })?.authority?.__fullProductRuntimeAuthority;
    if (marker !== this.authorityMarker) {
      throw new Error("The runtime snapshot was not issued by this runtime");
    }
  }
}

interface Seat {
  connection: FullProductConnection;
  session: { roomId: string; playerId: string; resumeToken: string };
}

function createHarness(roomId = "room") {
  const runtime = new TestRuntime();
  const validator: FullProductDeckValidator = validateDeck;
  const orchestrator = new FullProductRoomOrchestrator({
    roomId,
    runtime,
    validateDeck: validator
  });
  const aliceConnection = orchestrator.join("Alice", "alice-1");
  const bobConnection = orchestrator.join("Bob", "bob-1");
  const seats: Record<"alice" | "bob", Seat> = {
    alice: {
      connection: aliceConnection,
      session: {
        roomId,
        playerId: aliceConnection.playerId,
        resumeToken: aliceConnection.resumeToken
      }
    },
    bob: {
      connection: bobConnection,
      session: {
        roomId,
        playerId: bobConnection.playerId,
        resumeToken: bobConnection.resumeToken
      }
    }
  };
  return { orchestrator, runtime, seats };
}

function submitDeckAndReady(
  orchestrator: FullProductRoomOrchestrator,
  seat: Seat,
  deck: RoomDeckSubmission = legalDeck
): FullProductCommandReceipt | ReturnType<FullProductRoomOrchestrator["setReady"]> {
  orchestrator.submitDeck(
    seat.session,
    seat.connection.connectionId,
    orchestrator.currentRoomVersion,
    deck
  );
  return orchestrator.setReady(
    seat.session,
    seat.connection.connectionId,
    orchestrator.currentRoomVersion,
    true
  );
}

function catchError(operation: () => unknown): FullProductOrchestrationError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(FullProductOrchestrationError);
    return error as FullProductOrchestrationError;
  }
  throw new Error("Expected the operation to fail");
}

function submitPass(
  orchestrator: FullProductRoomOrchestrator,
  seat: Seat,
  commandId: string,
  expectedVersion: number
): FullProductCommandReceipt {
  return orchestrator.submitCommand(
    seat.session,
    seat.connection.connectionId,
    commandId,
    expectedVersion,
    { type: "pass" }
  );
}

describe("full product room orchestrator", () => {
  it("creates a two-player room and validates decks before accepting them", () => {
    const { orchestrator, seats } = createHarness("room-1");

    expect(orchestrator.roomId).toBe("room-1");
    expect(orchestrator.playerCount).toBe(2);
    expect(orchestrator.connectedPlayerCount).toBe(2);
    expect(orchestrator.status).toBe("waiting");
    expect(orchestrator.roomView().players).toEqual([
      expect.objectContaining({
        id: "player-1",
        name: "Alice",
        connected: true,
        ready: false,
        deckSubmitted: false
      }),
      expect.objectContaining({
        id: "player-2",
        name: "Bob",
        connected: true,
        ready: false,
        deckSubmitted: false
      })
    ]);
    expect(orchestrator.roomEvents().map(event => event.type)).toEqual([
      "room-created",
      "player-joined",
      "player-joined"
    ]);

    const before = orchestrator.roomView();
    expect(catchError(() => orchestrator.submitDeck(
      seats.alice.session,
      seats.alice.connection.connectionId,
      orchestrator.currentRoomVersion,
      {}
    )).code).toBe("invalid-deck");
    expect(orchestrator.roomView()).toEqual(before);

    expect(catchError(() => orchestrator.submitDeck(
      seats.alice.session,
      seats.alice.connection.connectionId,
      orchestrator.currentRoomVersion + 1,
      legalDeck
    )).code).toBe("stale-version");
    expect(orchestrator.roomView()).toEqual(before);
  });

  it("starts only after both connected players submit legal decks and ready", () => {
    const { orchestrator, seats } = createHarness("room-2");

    expect(catchError(() => orchestrator.setReady(
      seats.alice.session,
      seats.alice.connection.connectionId,
      orchestrator.currentRoomVersion,
      true
    )).code).toBe("invalid-deck");

    submitDeckAndReady(orchestrator, seats.alice);
    expect(orchestrator.status).toBe("waiting");

    orchestrator.disconnect(seats.bob.connection.playerId, "bob-1");
    expect(orchestrator.status).toBe("waiting");

    const bobReconnected = orchestrator.reconnect(
      seats.bob.connection.resumeToken,
      "bob-2"
    );
    expect(bobReconnected).not.toBeNull();
    seats.bob.connection = {
      playerId: bobReconnected?.session.playerId ?? "player-2",
      resumeToken: bobReconnected?.session.resumeToken ?? "",
      connectionId: "bob-2"
    };
    submitDeckAndReady(orchestrator, seats.bob);
    expect(orchestrator.status).toBe("playing");
    expect(orchestrator.roomEvents().at(-1)?.type).toBe("match-started");
    expect(orchestrator.summary()).toMatchObject({
      version: 1,
      eventSeq: 1,
      activePlayerId: "player-1"
    });
  });

  it("stamps actors, checks versions and legality, and deduplicates commands", () => {
    const { orchestrator, runtime, seats } = createHarness("room-3");
    submitDeckAndReady(orchestrator, seats.alice);
    submitDeckAndReady(orchestrator, seats.bob);

    expect(catchError(() => submitPass(
      orchestrator,
      seats.alice,
      "alice-stale",
      2
    )).code).toBe("stale-version");

    expect(catchError(() => orchestrator.submitCommand(
      seats.bob.session,
      seats.bob.connection.connectionId,
      "bob-illegal",
      1,
      { type: "pass" }
    )).code).toBe("invalid_command");

    const first = submitPass(orchestrator, seats.alice, "alice-pass", 1);
    expect(first).toMatchObject({
      commandId: "alice-pass",
      duplicate: false,
      appliedVersion: 2,
      eventSeq: 2
    });
    expect(runtime.submittedCommands).toEqual([
      { type: "pass", playerId: "player-1" }
    ]);

    const duplicate = submitPass(orchestrator, seats.alice, "alice-pass", 1);
    expect(duplicate).toMatchObject({
      commandId: "alice-pass",
      duplicate: true,
      appliedVersion: 2,
      eventSeq: 2
    });
    expect(runtime.submittedCommands).toHaveLength(1);

    expect(catchError(() => orchestrator.submitCommand(
      seats.alice.session,
      seats.alice.connection.connectionId,
      "alice-pass",
      2,
      { type: "concede" }
    )).code).toBe("idempotency-conflict");

    expect(submitPass(
      orchestrator,
      seats.bob,
      "bob-pass",
      2
    )).toMatchObject({
      commandId: "bob-pass",
      duplicate: false,
      appliedVersion: 3,
      eventSeq: 3
    });
  });

  it("reconnects before and during a match without exposing private projections", () => {
    const { orchestrator, seats } = createHarness("room-4");
    orchestrator.disconnect("player-1", "alice-1");
    const beforeStart = orchestrator.reconnect(
      seats.alice.connection.resumeToken,
      "alice-2",
      0,
      3
    );
    expect(beforeStart?.projection).toBeNull();
    expect(beforeStart?.missedEvents).toEqual([]);
    expect(beforeStart?.missedRoomEvents.map(event => event.type)).toEqual([
      "player-disconnected",
      "player-reconnected"
    ]);
    seats.alice.connection = {
      playerId: "player-1",
      resumeToken: seats.alice.connection.resumeToken,
      connectionId: "alice-2"
    };

    submitDeckAndReady(orchestrator, seats.alice);
    submitDeckAndReady(orchestrator, seats.bob);
    const aliceProjection = orchestrator.projectionFor("player-1");
    expect(aliceProjection.players[0]?.hand).toEqual([
      { instanceId: "alice-card", cardId: "fixture.card" }
    ]);
    expect(aliceProjection.players[1]?.hand).toEqual([]);
    expect(aliceProjection.objects.filter(object => object.zone === "hand"))
      .toHaveLength(1);
    expect(JSON.stringify(aliceProjection)).not.toContain("privateRuntimeField");

    const pass = submitPass(orchestrator, seats.alice, "alice-pass", 1);
    orchestrator.disconnect("player-1", "alice-2");
    const resumed = orchestrator.reconnect(
      seats.alice.connection.resumeToken,
      "alice-3",
      pass.eventSeq - 1,
      0
    );
    expect(resumed?.projection?.version).toBe(pass.appliedVersion);
    expect(resumed?.missedEvents.map(event => event.seq)).toEqual([2]);
    expect(resumed?.missedRoomEvents.some(event =>
      event.type === "player-disconnected"
    )).toBe(true);

    expect(catchError(() => submitPass(
      orchestrator,
      seats.alice,
      "old-socket-pass",
      pass.appliedVersion
    )).code).toBe("session-replaced");
  });

  it("returns match result and emits one terminal room event after concession", () => {
    const { orchestrator, runtime, seats } = createHarness("room-5");
    submitDeckAndReady(orchestrator, seats.alice);
    submitDeckAndReady(orchestrator, seats.bob);

    const concession = orchestrator.submitCommand(
      seats.alice.session,
      seats.alice.connection.connectionId,
      "alice-concede",
      1,
      { type: "concede" }
    );
    expect(concession.appliedVersion).toBe(2);
    expect(orchestrator.status).toBe("ended");
    expect(orchestrator.matchResult()).toMatchObject({
      winnerPlayerId: "player-2",
      reason: "concession",
      finalVersion: 2,
      finalEventSeq: 2
    });
    const terminalEvents = orchestrator.roomEvents().filter(event =>
      event.type === "match-ended"
    );
    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]).toMatchObject({
      winnerPlayerId: "player-2",
      playerId: "player-2"
    });
    expect(orchestrator.legalActionsFor("player-1")).toEqual([]);
    expect(catchError(() => orchestrator.submitCommand(
      seats.bob.session,
      seats.bob.connection.connectionId,
      "bob-after-end",
      2,
      { type: "concede" }
    )).code).toBe("game_ended");
    expect(runtime.submittedCommands).toHaveLength(1);

    const replay = orchestrator.sendMatchEvents(
      seats.alice.session,
      seats.alice.connection.connectionId,
      0,
      orchestrator.currentRoomEventSeq - 1
    ) as FullProductReplayState;
    expect(replay.nextEventSeq).toBe(2);
    expect(replay.nextRoomEventSeq).toBe(orchestrator.currentRoomEventSeq);
    expect(replay.events.some(event => event.type === "game-started"))
      .toBe(true);
    expect(replay.roomEvents.some(event => event.type === "match-ended"))
      .toBe(true);
  });
});
