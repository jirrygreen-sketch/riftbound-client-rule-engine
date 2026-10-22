import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_V2_VERSION,
  PROTOCOL_V2_COMMAND_CONTRACT,
  PROTOCOL_V2_EVENT_CONTRACT,
  PROTOCOL_V2_PROJECTION_CONTRACT,
  isV2Command,
  isV2CommandEnvelope,
  isV2EngineEvent,
  isV2Projection,
  isV2ClientMessage,
  isV2ServerMessage,
  isV2EventJournalRecord
} from "../../dist/v2/index.js";

const base = { commandId: "cmd-1", stateVersion: 7 };

test("v2 admits every engine command with idempotency and state version", () => {
  const commands = [
    { ...base, type: "mulligan", selectedUIDs: ["a-hand-1"] },
    { ...base, type: "play", cardObjectId: "a-hand-1", cost: { energy: 2 },
      targets: [{ kind: "object", objectId: "b-unit-1" }], picks: [{ kind: "value", value: "mode-a" }] },
    { ...base, type: "play", cardObjectId: "a-hand-2",
      destination: { kind: "battlefield", battlefieldId: "field-1" } },
    { ...base, type: "activate", sourceObjectId: "a-gear-1", abilityId: "equip",
      cost: { power: [{ domains: ["Fury"], amount: 1 }] } },
    { ...base, type: "pass" },
    { ...base, type: "choose", choiceId: "choice-1", answer: ["a-hand-1", true] },
    { ...base, type: "move", objectId: "a-unit-1", to: { zone: "battlefield", locationId: "field-1" } },
    { ...base, type: "declare-attack", battlefieldId: "field-1", attackerObjectIds: ["a-unit-1"] },
    { ...base, type: "declare-defense", battlefieldId: "field-1", defenderObjectIds: ["b-unit-1"] },
    { ...base, type: "concede" },
    { ...base, type: "end-turn" },
    { ...base, type: "advance" },
    { ...base, type: "combat-damage", combatId: "combat-1",
      assignments: [{ unitObjectId: "b-unit-1", amount: 3 }] },
    { ...base, type: "rune-energy", runeObjectId: "a-rune-1", zoneEntryId: 0 },
    { ...base, type: "rune-power", runeObjectId: "b-rune-1", zoneEntryId: 1 }
  ];
  for (const command of commands) assert.equal(isV2Command(command), true, command.type);
  assert.equal(isV2CommandEnvelope({ contract: PROTOCOL_V2_COMMAND_CONTRACT, command: commands[1] }), true);
});

test("v2 rejects stale, actor-bearing, malformed, and null-cost commands", () => {
  const play = { ...base, type: "play", cardObjectId: "a-hand-1" };
  for (const value of [
    { ...play, commandId: "" },
    { ...play, stateVersion: -1 },
    { ...play, playerId: "alice" },
    { ...play, cost: { energy: null } },
    { ...play, targets: [{ kind: "object", objectId: "" }] },
    { ...play, picks: [{ kind: "unknown", value: "x" }] },
    { ...play, destination: { kind: "base", playerId: "" } },
    { ...base, type: "combat-damage", combatId: "combat-1", assignments: [] },
    { ...base, type: "combat-damage", combatId: "combat-1",
      assignments: [{ unitObjectId: "b-unit-1", amount: 0 }] },
    { ...base, type: "combat-damage", combatId: "combat-1",
      assignments: [{ unitObjectId: "b-unit-1", amount: 1 }, { unitObjectId: "b-unit-1", amount: 1 }] },
    { ...base, type: "mulligan" },
    { ...base, type: "pass", expectedVersion: 7 }
  ]) assert.equal(isV2Command(value), false);
});

const publicEvent = {
  contract: PROTOCOL_V2_EVENT_CONTRACT,
  seq: 8,
  eventSeq: 8,
  stateVersion: 7,
  timingPoint: "card-played",
  audience: { visibility: "public" },
  payload: {
    objectId: { visibility: "public", value: "a-unit-1" },
    privateCost: { visibility: "owner-only", ownerPlayerId: "alice", value: { energy: 2 } },
    hiddenCard: { visibility: "hidden" }
  }
};

test("events carry closed timing ids and journal-v1 sequence fields", () => {
  assert.equal(isV2EngineEvent(publicEvent), true);
  assert.equal(isV2EventJournalRecord({
    kind: "event", ...publicEvent, rulesetVersion: "core-1.5",
    journalFormat: "riftbound-journal", journalVersion: 1
  }), true);
  assert.equal(isV2EngineEvent({ ...publicEvent, timingPoint: "made-up-point" }), false);
  assert.equal(isV2EngineEvent({ ...publicEvent, payload: { leak: { visibility: "hidden", value: "secret" } } }), false);
});

function projection(viewer) {
  const eventForViewer = viewer === "alice" ? publicEvent : {
    ...publicEvent,
    payload: { ...publicEvent.payload, privateCost: { visibility: "hidden" } }
  };
  return {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "match-1",
    viewerPlayerId: viewer,
    stateVersion: 7,
    eventSeq: 8,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 1, energy: 2, power: { Fury: 1 }, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 6, zoneCounts: { hand: 1, deck: 20 } },
      { playerId: "bob", name: "Bob", score: 0, energy: 1, power: {}, xp: 0,
        handCount: 1, deckCount: 20, runeDeckCount: 6, zoneCounts: { hand: 1, deck: 20 } }
    ],
    zones: [
      { zone: "hand", ownerPlayerId: "alice", count: 1, objects: viewer === "alice" ? [
        { objectId: "a-hand-1", zone: "hand", ownerPlayerId: "alice", cardId: "card.a", faceDown: false, visibility: "owner-only" }
      ] : undefined },
      { zone: "hand", ownerPlayerId: "bob", count: 1 },
      { zone: "deck", ownerPlayerId: "alice", count: 20 },
      { zone: "rune-deck", ownerPlayerId: "alice", count: 6 },
      { zone: "board", ownerPlayerId: "alice", count: 1, objects: [
        { objectId: "a-unit-1", zone: "board", ownerPlayerId: "alice", cardId: "unit.a", faceDown: false, visibility: "public",
          location: { kind: "battlefield", battlefieldId: "field-1" }, might: 2, damage: 0 }
      ] }
    ],
    objects: [
      { objectId: "a-unit-1", zone: "board", ownerPlayerId: "alice", cardId: "unit.a", faceDown: false, visibility: "public",
        location: { kind: "battlefield", battlefieldId: "field-1" }, might: 2, damage: 0 }
    ],
    chain: { status: "open", phase: "open", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "alice", points: 1, controlledBattlefieldIds: ["field-1"], scoredBattlefieldLocationIds: [] },
      { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "alice", contestedByPlayerId: null,
      staged: "none", occupantObjectIds: ["a-unit-1"] }],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays: [] },
    pendingChoice: viewer === "alice" ? { status: "pending", choiceId: "choice-1", ownerPlayerId: "alice", stateVersion: 7,
      kind: "mode", options: [{ id: "yes", label: "Yes", value: true }] } :
      { status: "pending", choiceId: "choice-1", ownerPlayerId: "alice", stateVersion: 7, kind: "mode" },
    winnerPlayerId: null,
    events: [eventForViewer]
  };
}

test("projections preserve owner privacy and never expose hidden zone order", () => {
  assert.equal(isV2Projection(projection("alice")), true);
  assert.equal(isV2Projection(projection("bob")), true);
  assert.equal(isV2Projection(projection(null)), true);
  const opponentLeak = projection("bob");
  opponentLeak.zones[0].objects = [{ objectId: "a-hand-1", zone: "hand", ownerPlayerId: "alice", cardId: "card.a", faceDown: false, visibility: "owner-only" }];
  assert.equal(isV2Projection(opponentLeak), false);
  const deckLeak = projection("alice");
  deckLeak.zones[2].objects = [];
  assert.equal(isV2Projection(deckLeak), false);
  const facedownLeak = projection("alice");
  facedownLeak.objects.push({ objectId: "secret", zone: "facedown", ownerPlayerId: "alice", cardId: "secret.card", faceDown: true, visibility: "public" });
  assert.equal(isV2Projection(facedownLeak), false);
  const deckObjectLeak = projection("alice");
  deckObjectLeak.objects.push({ objectId: "deck-secret", zone: "deck", ownerPlayerId: "alice", cardId: "secret.card", faceDown: false, visibility: "public" });
  assert.equal(isV2Projection(deckObjectLeak), false);
  const choiceLeak = projection("bob");
  choiceLeak.pendingChoice.options = [{ id: "secret", label: "Secret" }];
  assert.equal(isV2Projection(choiceLeak), false);
  const malformedCombat = projection("alice");
  malformedCombat.combat = { status: "active", battlefieldId: "field-1", step: "damage" };
  assert.equal(isV2Projection(malformedCombat), false);
  const malformedActions = projection("alice");
  malformedActions.actionOptions.moves = [{ objectId: "", destination: { kind: "base", playerId: "alice" } }];
  assert.equal(isV2Projection(malformedActions), false);
});

test("object choice candidates require complete object refs and remain chooser-only", () => {
  const objectChoice = projection("alice");
  objectChoice.objects[0].zoneEntryId = 1;
  objectChoice.pendingChoice = {
    status: "pending",
    choiceId: "objects-1",
    ownerPlayerId: "alice",
    stateVersion: 7,
    kind: "select-objects",
    options: [{ id: "a-unit-1", label: "Unit", value: "a-unit-1",
      objectRef: { objectId: "a-unit-1", zoneEntryId: 1 } }],
    min: 1,
    max: 1
  };
  assert.equal(isV2Projection(objectChoice), true);
  assert.equal(isV2Projection({ ...objectChoice, pendingChoice: {
    ...objectChoice.pendingChoice, kind: "order"
  } }), true);
  assert.equal(isV2Projection({ ...objectChoice, pendingChoice: {
    ...objectChoice.pendingChoice,
    options: [{ id: "a-unit-1", label: "Unit", objectRef: { objectId: "a-unit-1" } }]
  } }), false);
  assert.equal(isV2Projection({ ...objectChoice, pendingChoice: {
    ...objectChoice.pendingChoice,
    options: [{ id: "a-unit-1", label: "Unit", objectRef: { objectId: "a-unit-2", zoneEntryId: 1 } }]
  } }), false);
  for (const [kind, objectRef] of [
    ["mode", { objectId: "a-unit-1", zoneEntryId: 1 }],
    ["select-objects", { objectId: "a-unit-1", zoneEntryId: -1 }],
    ["select-objects", { objectId: "a-unit-1", zoneEntryId: 1, extra: true }]
  ]) {
    assert.equal(isV2Projection({ ...objectChoice, pendingChoice: {
      ...objectChoice.pendingChoice, kind, options: [{ id: "a-unit-1", label: "Unit", objectRef }]
    } }), false);
  }
  const opponent = projection("bob");
  opponent.pendingChoice.options = objectChoice.pendingChoice.options;
  assert.equal(isV2Projection(opponent), false);
});

test("choose command arrays retain legacy object-ref acceptance", () => {
  const choose = answer => ({ ...base, type: "choose", choiceId: "choice-1", answer });
  assert.equal(isV2Command(choose([{ objectId: "unit-1", zoneEntryId: 1 }])), true);
  assert.equal(isV2Command(choose([{ objectId: "unit-1" }])), true);
  assert.equal(isV2Command(choose([{ objectId: "unit-1", zoneEntryId: -1 }])), false);
  assert.equal(isV2Command(choose([{ objectId: "unit-1", zoneEntryId: 1, extra: true }])), false);
  assert.equal(isV2Command(choose(["legacy", true, 2])), true);
  assert.equal(isV2Command(choose([])), true);
});

test("transport guards admit only versioned v2 packets", () => {
  const commandPacket = { type: "command", protocolVersion: PROTOCOL_V2_VERSION, command: { ...base, type: "pass" } };
  const projectionPacket = { type: "projection", protocolVersion: PROTOCOL_V2_VERSION, projection: projection("alice") };
  const eventPacket = { type: "event", protocolVersion: PROTOCOL_V2_VERSION, event: publicEvent };
  assert.equal(isV2ClientMessage(commandPacket), true);
  assert.equal(isV2ServerMessage(projectionPacket), true);
  assert.equal(isV2ServerMessage(eventPacket), true);
  assert.equal(isV2ClientMessage({ ...commandPacket, protocolVersion: "1.0.0" }), false);
});
