import { describe, expect, it } from "vitest";
import {
  FOUNDATION_RULESET_ID,
  PROTOCOL_VERSION,
  PROJECTION_SCHEMA_V1,
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
    eventSeq: 2,
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
        energy: 0
      }
    ],
    ...overrides
  };
}

function makeFoundationProjection(): GameProjection {
  const legacy = makeProjection();
  const owner = legacy.players[0]!;
  const opponent = legacy.players[1]!;
  const { life: _ownerLife, mana: _ownerMana, ...ownerFields } = owner;
  const { life: _opponentLife, mana: _opponentMana, ...opponentFields } = opponent;
  const ownerHandObject = {
    objectId: owner.hand[0]!.instanceId,
    cardId: owner.hand[0]!.cardId,
    zone: "hand",
    controllerId: owner.id,
    ownerPlayerId: owner.id,
    faceUp: true
  } as const;
  return {
    ...legacy,
    projectionSchema: PROJECTION_SCHEMA_V1,
    rulesetId: FOUNDATION_RULESET_ID,
    priority: { playerId: legacy.activePlayerId },
    objects: [ownerHandObject],
    players: [
      {
        ...ownerFields,
        score: 0,
        energy: 0,
        power: {},
        zoneCounts: { hand: owner.handCount },
        playableInstanceIds: owner.hand.map(card => card.instanceId)
      },
      {
        ...opponentFields,
        score: 0,
        energy: 0,
        power: {},
        zoneCounts: { hand: opponent.handCount },
        playableInstanceIds: opponent.hand.map(card => card.instanceId)
      }
    ]
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
          version: 3,
          roomVersion: 6,
          roomEventSeq: 6,
          players: [
            {
              id: "player-1",
              name: "Alice",
              connected: true,
              ready: true,
              deckSubmitted: true
            },
            {
              id: "player-2",
              name: "Bob",
              connected: true,
              ready: true,
              deckSubmitted: true
            }
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
    expect(isGameProjection({
      ...makeProjection(),
      prompt,
      waitingForPlayerId: "player-2"
    })).toBe(false);
  });

  it("rejects projections with invalid privacy, score, hand, and replay metadata", () => {
    const valid = makeFoundationProjection();
    expect(isGameProjection(valid)).toBe(true);
    const ownerHand = valid.players[0]!.hand;

    expect(isGameProjection({
      ...valid,
      players: [
        valid.players[0]!,
        { ...valid.players[1]!, hand: ownerHand }
      ]
    })).toBe(false);
    expect(isGameProjection({
      ...valid,
      players: [
        { ...valid.players[0]!, handCount: ownerHand.length - 1 },
        valid.players[1]!
      ]
    })).toBe(false);
    expect(isGameProjection({ ...valid, eventSeq: 1 })).toBe(false);
    expect(isGameProjection({ ...valid, turnNumber: 0 })).toBe(false);
    expect(isGameProjection({ ...valid, winnerPlayerId: "" })).toBe(false);
    expect(isGameProjection({ ...valid, events: [{ ...valid.events[0]!, seq: 0 }] })).toBe(false);
    expect(isGameProjection({
      ...valid,
      players: valid.players.map(player => ({ ...player, score: undefined }))
    })).toBe(false);
    expect(isGameProjection({
      ...valid,
      players: valid.players.map(player => ({ ...player, life: 20 }))
    })).toBe(false);
  });

  it("separates synthetic-demo and foundation projection contracts", () => {
    const synthetic = makeProjection();
    const foundation = makeFoundationProjection();

    expect(isGameProjection(synthetic)).toBe(true);
    expect(isGameProjection(foundation)).toBe(true);
    expect(isGameProjection({
      ...foundation,
      players: foundation.players.map(player => ({ ...player, life: player.score }))
    })).toBe(false);
    expect(isGameProjection({
      ...synthetic,
      players: synthetic.players.map(player => ({ ...player, score: player.life }))
    })).toBe(false);
    expect(isGameProjection({
      ...synthetic,
      players: synthetic.players.map(player => ({
        ...player,
        life: undefined,
        score: 8,
        energy: 0
      }))
    })).toBe(false);
    expect(isGameProjection({
      ...foundation,
      rulesetId: RULESET_ID
    })).toBe(false);
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
