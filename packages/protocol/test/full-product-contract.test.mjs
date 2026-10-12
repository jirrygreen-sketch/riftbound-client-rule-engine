import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_PRODUCT_COMPATIBLE_PROTOCOL_VERSIONS,
  FULL_PRODUCT_EVENT_CONTRACT,
  FULL_PRODUCT_PROJECTION_CONTRACT,
  FULL_PRODUCT_PROTOCOL_VERSION,
  FULL_PRODUCT_RULESET_ID,
  isCompatibleFullProductProtocolVersion,
  isFullProductCommand,
  isFullProductCommandEnvelope,
  isFullProductCommandReceipt,
  isFullProductGameEvent,
  isFullProductProjection,
  isFullProductPrompt,
  isFullProductResumeBackfill,
  isFullProductResumeRequest,
  isFullProductTargetPolicy,
  isSameFullProductCommandIntent
} from "../dist/full-product-contract.js";

assert.equal(FULL_PRODUCT_PROTOCOL_VERSION, "0.3.0");
assert.deepEqual(FULL_PRODUCT_COMPATIBLE_PROTOCOL_VERSIONS, ["0.3.0", "0.2.0"]);
assert.equal(FULL_PRODUCT_EVENT_CONTRACT, "riftbound.full-product.event.v1");
assert.equal(
  FULL_PRODUCT_PROJECTION_CONTRACT,
  "riftbound.full-product.projection.v1"
);
assert.equal(FULL_PRODUCT_RULESET_ID, "riftbound-foundation");

const playerIds = ["player-1", "player-2"];
const noTargetPolicy = {
  minTargets: 0,
  maxTargets: 0,
  allowedZones: []
};
const objectTargetPolicy = {
  minTargets: 1,
  maxTargets: 2,
  allowedZones: ["battlefield", "champion"]
};
const target = {
  targetKind: "object",
  targetId: "player-1:creature-1"
};
const secondTarget = {
  targetKind: "player",
  targetId: "player-2"
};

function command(overrides = {}) {
  return {
    requestId: "request-1",
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 7,
    command: {
      type: "play-card",
      instanceId: "player-1:card-1",
      targets: [target]
    },
    ...overrides
  };
}

function event(overrides = {}) {
  return {
    type: "card-played",
    seq: 4,
    turnNumber: 2,
    activePlayerId: "player-1",
    priorityPlayerId: "player-2",
    playerId: "player-1",
    instanceId: "player-1:card-1",
    cardId: "card.fire",
    targets: [target],
    ...overrides
  };
}

function prompt(overrides = {}) {
  return {
    promptId: "prompt-1",
    ownerPlayerId: "player-2",
    stateVersion: 9,
    optional: true,
    targetPolicy: objectTargetPolicy,
    options: [
      { id: "confirm", label: "Confirm" },
      { id: "cancel", label: "Cancel" }
    ],
    ...overrides
  };
}

function projection(overrides = {}) {
  return {
    projectionContract: FULL_PRODUCT_PROJECTION_CONTRACT,
    protocolVersion: FULL_PRODUCT_PROTOCOL_VERSION,
    rulesetId: FULL_PRODUCT_RULESET_ID,
    viewerPlayerId: "player-1",
    version: 7,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    priorityPlayerId: "player-2",
    winnerPlayerId: null,
    waitingForPlayerId: null,
    prompt: null,
    players: [
      {
        id: "player-1",
        name: "Alice",
        score: 3,
        energy: 2,
        power: {},
        handCount: 2,
        zoneCounts: { hand: 2, deck: 30 },
        playableInstanceIds: ["player-1:card-1"]
      },
      {
        id: "player-2",
        name: "Bob",
        score: 1,
        energy: 4,
        power: {},
        handCount: 4,
        zoneCounts: { hand: 4, deck: 28 },
        playableInstanceIds: null
      }
    ],
    objects: [
      {
        objectId: "player-1:card-1",
        cardId: "card.fire",
        zone: "hand",
        controllerId: "player-1",
        ownerPlayerId: "player-1",
        faceUp: true,
        visibility: "private"
      },
      {
        objectId: "player-1:card-2",
        cardId: "card.water",
        zone: "hand",
        controllerId: "player-1",
        ownerPlayerId: "player-1",
        faceUp: true,
        visibility: "private"
      },
      {
        objectId: "battlefield-1",
        cardId: "card.creature",
        zone: "battlefield",
        controllerId: "player-1",
        ownerPlayerId: "player-1",
        faceUp: true,
        visibility: "public",
        counters: { shield: 1 },
        damage: 2
      }
    ],
    events: [
      {
        type: "game-started",
        seq: 1,
        turnNumber: 1,
        activePlayerId: "player-1",
        priorityPlayerId: "player-1",
        playerIds,
        rulesetId: FULL_PRODUCT_RULESET_ID
      },
      {
        type: "turn-started",
        seq: 2,
        turnNumber: 1,
        activePlayerId: "player-1",
        priorityPlayerId: "player-1",
        playerId: "player-1"
      },
      {
        type: "priority-passed",
        seq: 3,
        turnNumber: 1,
        activePlayerId: "player-1",
        priorityPlayerId: "player-2",
        playerId: "player-2"
      },
      event()
    ],
    ...overrides
  };
}

test("version and command wire shapes are explicit", () => {
  assert.equal(isCompatibleFullProductProtocolVersion("0.3.0"), true);
  assert.equal(isCompatibleFullProductProtocolVersion("0.2.0"), true);
  assert.equal(isCompatibleFullProductProtocolVersion("0.4.0"), false);

  assert.equal(isFullProductCommandEnvelope(command()), true);
  assert.equal(isFullProductCommandEnvelope(command({
    command: {
      type: "respond-to-prompt",
      promptId: "prompt-1",
      optionId: "confirm",
      targets: [target, secondTarget]
    }
  })), true);
  assert.equal(isFullProductCommandEnvelope(command({
    command: { type: "pass", targets: [] }
  })), false);
  assert.equal(isFullProductCommandEnvelope(command({
    command: {
      type: "play-card",
      instanceId: "player-1:card-1",
      targets: [target, target]
    }
  })), false);
  assert.equal(isFullProductCommandEnvelope(command({
    command: {
      type: "play-card",
      instanceId: "player-1:card-1",
      targets: [{ targetKind: "card", targetId: "x" }]
    }
  })), false);
  assert.equal(isFullProductCommandEnvelope(command({
    command: {
      type: "play-card",
      playerId: "player-1",
      instanceId: "player-1:card-1",
      targets: []
    }
  })), false);
  assert.equal(isFullProductCommandEnvelope(command({
    command: { type: "concede" },
    expectedVersion: -1
  })), false);
  assert.equal(isFullProductCommand({
    type: "respond-to-prompt",
    promptId: "prompt-1",
    optionId: "confirm",
    targets: [],
    stateVersion: 4
  }), false);
});

test("target and prompt contracts reject ambiguous or invalid policies", () => {
  assert.equal(isFullProductTargetPolicy(noTargetPolicy), true);
  assert.equal(isFullProductTargetPolicy(objectTargetPolicy), true);
  assert.equal(isFullProductTargetPolicy({
    minTargets: 2,
    maxTargets: 1,
    allowedZones: ["battlefield"]
  }), false);
  assert.equal(isFullProductTargetPolicy({
    minTargets: 0,
    maxTargets: 1,
    allowedZones: []
  }), false);
  assert.equal(isFullProductTargetPolicy({
    minTargets: 0,
    maxTargets: 0,
    allowedZones: ["hand"]
  }), false);
  assert.equal(isFullProductTargetPolicy({
    minTargets: 0,
    maxTargets: 0,
    allowedZones: ["mystic-zone"]
  }), false);

  assert.equal(isFullProductPrompt(prompt()), true);
  assert.equal(isFullProductPrompt(prompt({
    ownerPlayerId: "not-player-2"
  })), true);
  assert.equal(isFullProductPrompt(prompt({ stateVersion: -1 })), false);
  assert.equal(isFullProductPrompt(prompt({ optional: "yes" })), false);
  assert.equal(isFullProductPrompt(prompt({
    targetPolicy: noTargetPolicy
  })), true);
  assert.equal(isFullProductPrompt(prompt({
    options: [
      { id: "confirm", label: "Confirm" },
      { id: "confirm", label: "Again" }
    ]
  })), false);
  assert.equal(isFullProductPrompt({
    ...prompt(),
    privateOptions: ["secret"]
  }), false);
});

test("events are public and sequence-bound", () => {
  assert.equal(isFullProductGameEvent(event()), true);
  assert.equal(isFullProductGameEvent({
    type: "prompt-created",
    seq: 5,
    turnNumber: 2,
    activePlayerId: "player-1",
    priorityPlayerId: "player-2",
    promptId: "prompt-1",
    ownerPlayerId: "player-2",
    stateVersion: 9,
    optional: true,
    targetPolicy: objectTargetPolicy
  }), true);
  assert.equal(isFullProductGameEvent(event({ seq: 0 })), false);
  assert.equal(isFullProductGameEvent(event({ priorityPlayerId: "" })), false);
  assert.equal(isFullProductGameEvent(event({ type: "card-played", cardId: 7 })), false);
  assert.equal(isFullProductGameEvent(event({
    targets: [target, target]
  })), false);
  assert.equal(isFullProductGameEvent({
    ...event({ type: "prompt-created" }),
    promptId: "prompt-1",
    ownerPlayerId: "player-2",
    stateVersion: 9,
    optional: true,
    targetPolicy: objectTargetPolicy,
    options: [{ id: "secret", label: "Secret" }]
  }), false);
});

test("projections enforce viewer-specific private information", () => {
  const valid = projection();
  assert.equal(isFullProductProjection(valid), true);

  const opponentPrivateCard = {
    objectId: "player-2:card-1",
    cardId: "card.secret",
    zone: "hand",
    controllerId: "player-2",
    ownerPlayerId: "player-2",
    faceUp: true,
    visibility: "private"
  };
  assert.equal(isFullProductProjection({
    ...valid,
    objects: [...valid.objects, opponentPrivateCard]
  }), false);

  assert.equal(isFullProductProjection({
    ...valid,
    players: [
      valid.players[0],
      { ...valid.players[1], playableInstanceIds: ["player-2:card-1"] }
    ]
  }), false);

  const publicPrompt = { ...prompt(), ownerPlayerId: "player-1" };
  assert.equal(isFullProductProjection({
    ...valid,
    waitingForPlayerId: "player-1",
    prompt: publicPrompt
  }), true);
  assert.equal(isFullProductProjection({
    ...valid,
    waitingForPlayerId: "player-2",
    prompt
  }), false);

  assert.equal(isFullProductProjection({
    ...valid,
    viewerPlayerId: "player-2",
    waitingForPlayerId: "player-1",
    prompt: publicPrompt
  }), false);

  const spectator = {
    ...valid,
    viewerPlayerId: null,
    players: [
      {
        ...valid.players[0],
        playableInstanceIds: null,
        handCount: 0,
        zoneCounts: { ...valid.players[0].zoneCounts, hand: 0 }
      },
      valid.players[1]
    ],
    objects: valid.objects.filter(object => object.visibility !== "private")
  };
  assert.equal(isFullProductProjection(spectator), true);
  assert.equal(isFullProductProjection({
    ...spectator,
    objects: [...spectator.objects, {
      ...opponentPrivateCard,
      visibility: "private",
      ownerPlayerId: "player-1"
    }]
  }), false);
});

test("projections reject contradictory state and event sequences", () => {
  const valid = projection();
  assert.equal(isFullProductProjection({
    ...valid,
    protocolVersion: "0.4.0"
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    projectionContract: "riftbound.projection.v1"
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    rulesetId: "synthetic-demo"
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    viewerPlayerId: "player-3"
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    eventSeq: 3
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    events: [valid.events[0], valid.events[2]]
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    events: [valid.events[1], valid.events[2], valid.events[3]]
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    players: [
      { ...valid.players[0], handCount: 3, zoneCounts: { hand: 3 } },
      valid.players[1]
    ]
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    players: [
      {
        ...valid.players[0],
        playableInstanceIds: ["player-1:card-1", "player-1:card-1"]
      },
      valid.players[1]
    ]
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    objects: [
      ...valid.objects,
      { ...valid.objects[2], objectId: "hand-secret", zone: "hand" }
    ]
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    phase: "ended"
  }), false);
  assert.equal(isFullProductProjection({
    ...valid,
    events: [
      ...valid.events,
      {
        type: "game-ended",
        seq: 5,
        turnNumber: 2,
        activePlayerId: "player-1",
        priorityPlayerId: "player-1",
        winnerPlayerId: "player-1"
      }
    ]
  }), false);

  const ended = projection({
    phase: "ended",
    eventSeq: 5,
    winnerPlayerId: "player-1",
    players: [
      { ...valid.players[0], playableInstanceIds: null },
      valid.players[1]
    ],
    objects: valid.objects.filter(object =>
      object.visibility !== "private" ||
      object.ownerPlayerId === valid.viewerPlayerId),
    events: [
      ...valid.events,
      {
        type: "game-ended",
        seq: 5,
        turnNumber: 2,
        activePlayerId: "player-1",
        priorityPlayerId: "player-1",
        winnerPlayerId: "player-1"
      }
    ]
  });
  assert.equal(isFullProductProjection(ended), true);
  assert.equal(isFullProductProjection({
    ...ended,
    winnerPlayerId: null
  }), false);
});

test("resume backfill closes both event cursors without private replay", () => {
  const current = projection();
  const backfill = {
    type: "resume-backfill",
    roomId: "room-1",
    projection: current,
    afterEventSeq: 2,
    nextEventSeq: 4,
    events: [current.events[2], current.events[3]],
    roomVersion: 3,
    afterRoomEventSeq: 1,
    nextRoomEventSeq: 2
  };
  assert.equal(isFullProductResumeRequest({
    type: "resume",
    protocolVersion: FULL_PRODUCT_PROTOCOL_VERSION,
    roomId: "room-1",
    resumeToken: "token",
    afterEventSeq: 2,
    afterRoomEventSeq: 1
  }), true);
  assert.equal(isFullProductResumeRequest({
    type: "resume",
    protocolVersion: "0.4.0",
    roomId: "room-1",
    resumeToken: "token",
    afterEventSeq: 2,
    afterRoomEventSeq: 1
  }), false);
  assert.equal(isFullProductResumeBackfill(backfill), true);
  assert.equal(isFullProductResumeBackfill({
    ...backfill,
    afterEventSeq: 3
  }), false);
  assert.equal(isFullProductResumeBackfill({
    ...backfill,
    events: [current.events[3]]
  }), false);
  assert.equal(isFullProductResumeBackfill({
    ...backfill,
    nextEventSeq: 3
  }), false);
  assert.equal(isFullProductResumeBackfill({
    ...backfill,
    afterRoomEventSeq: 3,
    nextRoomEventSeq: 2
  }), false);
});

test("idempotent retries compare command intent and reject payload drift", () => {
  const first = command();
  const duplicate = command({ requestId: "request-2", expectedVersion: 8 });
  assert.equal(isFullProductCommandReceipt({
    type: "command-result",
    requestId: "request-2",
    commandId: first.commandId,
    duplicate: true,
    appliedVersion: 7,
    eventSeq: 4,
    roomVersion: 3,
    roomEventSeq: 2
  }), true);
  assert.equal(isSameFullProductCommandIntent(first, duplicate), true);
  assert.equal(isSameFullProductCommandIntent(first, command({
    commandId: "22222222-2222-4222-8222-222222222222"
  })), false);
  assert.equal(isSameFullProductCommandIntent(first, command({
    requestId: "request-2",
    command: {
      type: "play-card",
      instanceId: "player-1:card-2",
      targets: [target]
    }
  })), false);
  assert.equal(isSameFullProductCommandIntent(first, command({
    requestId: "request-2",
    command: {
      type: "play-card",
      instanceId: "player-1:card-1",
      targets: [secondTarget]
    }
  })), false);
  assert.equal(isSameFullProductCommandIntent(first, command({
    requestId: "request-2",
    command: {
      type: "pass",
      targets: [target]
    }
  })), false);
});
