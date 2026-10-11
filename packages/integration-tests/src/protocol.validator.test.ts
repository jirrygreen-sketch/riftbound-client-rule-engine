import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  RULESET_ID,
  isClientMessage,
  isGameEvent,
  isGameProjection,
  isPrompt,
  isServerMessage,
  type GameEvent,
  type GameProjection
} from "@riftbound/protocol";

function makeProjection(overrides: Partial<GameProjection> = {}): GameProjection {
  return {
    version: 3,
    eventSeq: 3,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    players: [
      {
        id: "player-1",
        name: "Alice",
        life: 20,
        mana: 1,
        handCount: 1,
        hand: [{ instanceId: "player-1:trigger-conquer", cardId: "card.trigger-conquer" }]
      },
      {
        id: "player-2",
        name: "Bob",
        life: 20,
        mana: 1,
        handCount: 1,
        hand: []
      }
    ],
    events: [
      {
        type: "game-started",
        seq: 1,
        turnNumber: 1,
        activePlayerId: "player-1",
        playerIds: ["player-1", "player-2"]
      },
      {
        type: "turn-started",
        seq: 2,
        turnNumber: 1,
        activePlayerId: "player-1",
        playerId: "player-1",
        mana: 1
      }
    ],
    ...overrides
  };
}

describe("client message validator", () => {
  it("accepts every supported client message", () => {
    const messages = [
      { type: "hello", protocolVersion: PROTOCOL_VERSION },
      { type: "create-room", requestId: "create-1", playerName: "Alice" },
      { type: "join-room", requestId: "join-1", roomId: "room-1", playerName: "Bob" },
      {
        type: "command",
        requestId: "request-1",
        commandId: "command-1",
        expectedVersion: 3,
        command: { type: "pass" }
      },
      {
        type: "command",
        requestId: "request-2",
        commandId: "command-2",
        expectedVersion: 3,
        command: {
          type: "respond-to-prompt",
          promptId: "prompt-1",
          optionId: "resolve",
          stateVersion: 4
        }
      },
      { type: "ping" }
    ] as const;

    for (const message of messages) {
      expect(isClientMessage(message), JSON.stringify(message)).toBe(true);
    }
  });

  it("rejects actor fields, extra fields, partial resume data, and invalid versions", () => {
    const invalid = [
      { type: "pass" },
      { type: "hello", protocolVersion: PROTOCOL_VERSION, roomId: "room-1" },
      { type: "create-room", requestId: "create-1", playerName: "Alice", extra: true },
      {
        type: "command",
        requestId: "request-1",
        commandId: "command-1",
        expectedVersion: -1,
        command: { type: "pass" }
      },
      {
        type: "command",
        requestId: "request-1",
        commandId: "command-1",
        expectedVersion: 1,
        command: { type: "pass", playerId: "player-1" }
      },
      {
        type: "command",
        requestId: "request-1",
        commandId: "command-1",
        expectedVersion: 1,
        command: {
          type: "respond-to-prompt",
          promptId: "prompt-1",
          optionId: "resolve",
          stateVersion: -1
        }
      }
    ];

    for (const message of invalid) {
      expect(isClientMessage(message), JSON.stringify(message)).toBe(false);
    }
  });
});

describe("server message and projection validators", () => {
  it("accepts a valid welcome, room view, receipt, projection, error, and pong", () => {
    const projection = makeProjection();
    const messages = [
      {
        type: "welcome",
        protocolVersion: PROTOCOL_VERSION,
        session: { roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" },
        resumed: true
      },
      {
        type: "room",
        room: {
          roomId: "room-1",
          status: "playing",
          rulesetId: RULESET_ID,
          players: [
            { id: "player-1", name: "Alice", connected: true },
            { id: "player-2", name: "Bob", connected: true }
          ]
        }
      },
      {
        type: "request-result",
        requestId: "request-1",
        ok: true,
        commandId: "command-1",
        appliedVersion: 4,
        eventSeq: 5,
        duplicate: false
      },
      { type: "projection", roomId: "room-1", projection },
      { type: "error", requestId: "request-2", code: "stale-version", message: "Stale version" },
      { type: "pong" }
    ] as const;

    for (const message of messages) {
      expect(isServerMessage(message), JSON.stringify(message)).toBe(true);
    }
  });

  it("rejects the legacy flat welcome and legacy room view shapes", () => {
    expect(
      isServerMessage({
        type: "welcome",
        protocolVersion: PROTOCOL_VERSION,
        playerId: "player-1",
        resumeToken: "resume-1",
        roomId: "room-1",
        resumed: false
      })
    ).toBe(false);

    expect(
      isServerMessage({
        type: "room",
        room: { id: "room-1", status: "playing", seats: 2, filledSeats: 2 }
      })
    ).toBe(false);
  });

  it("requires a coherent pending prompt and a valid projection", () => {
    const prompt = {
      id: "prompt:task-1",
      ownerPlayerId: "player-1",
      playerId: "player-1",
      stateVersion: 4,
      status: "pending",
      taskId: "task-1",
      reason: "trigger-conquer",
      optional: true,
      options: [
        { id: "resolve", label: "Resolve trigger" },
        { id: "skip", label: "Skip trigger" }
      ]
    } as const;

    expect(isPrompt(prompt)).toBe(true);
    expect(isGameProjection(makeProjection({
      prompt,
      waitingForPlayerId: "player-1"
    }))).toBe(true);
    expect(isPrompt({ ...prompt, ownerPlayerId: "player-2" })).toBe(false);
    expect(isPrompt({ ...prompt, options: [prompt.options[0], prompt.options[0]] })).toBe(false);
    expect(isGameProjection(makeProjection({ players: [makeProjection().players[0]!] }))).toBe(false);
  });

  it("validates event discriminants and rejects extra event fields", () => {
    const gameStarted: GameEvent = {
      type: "game-started",
      seq: 1,
      turnNumber: 1,
      activePlayerId: "player-1",
      playerIds: ["player-1", "player-2"]
    };

    expect(isGameEvent(gameStarted)).toBe(true);
    expect(isGameEvent({ ...gameStarted, extra: true })).toBe(false);
    expect(isGameEvent({ ...gameStarted, seq: 0 })).toBe(false);
  });
});
