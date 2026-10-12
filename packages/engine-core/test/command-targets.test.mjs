import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredGame, projectGame, submitCommand } from "../dist/index.js";
import { isClientMessage, isCommand, isGameProjection } from "@riftbound/protocol";

function fixture() {
  return createConfiguredGame({
    players: [
      {
        id: "a", name: "Alice",
        startingHand: [{ instanceId: "strike", cardId: "strike" }],
        deck: [{ instanceId: "secret", cardId: "unit" }]
      },
      { id: "b", name: "Bob", board: [{ instanceId: "target", cardId: "unit" }] }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 0, types: ["unit"], health: 4 },
      {
        id: "strike", name: "Strike", cost: 0, types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] }
      }
    ]
  });
}

test("an explicit legal target resolves atomically without a manual effect click", () => {
  const state = fixture();
  const result = submitCommand(state, {
    type: "play-card", playerId: "a", instanceId: "strike",
    targets: [{ kind: "object", objectId: "target" }]
  });
  assert.equal(result.error, null);
  assert.equal(state.objects.target.damage, 0);
  assert.equal(result.state.objects.target.damage, 2);
  assert.equal(result.state.prompt, null);
  assert.equal(result.state.objects.strike.zone, "discard");
  assert.equal(result.state.outstandingTasks.length, 0);
});

test("hidden, forged, duplicate and player damage targets cannot mutate the state", () => {
  const state = fixture();
  for (const targets of [
    [{ kind: "object", objectId: "secret" }],
    [{ kind: "object", objectId: "missing" }],
    [{ kind: "player", playerId: "b" }],
    [{ kind: "object", objectId: "target" }, { kind: "object", objectId: "target" }]
  ]) {
    const result = submitCommand(state, {
      type: "play-card", playerId: "a", instanceId: "strike", targets
    });
    assert.equal(result.error?.code, "invalid_command");
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
  }
});

test("either authenticated player can concede during an opposing target prompt", () => {
  const prompted = submitCommand(fixture(), {
    type: "play-card", playerId: "a", instanceId: "strike"
  }).state;
  assert.ok(prompted.prompt);
  const invalid = submitCommand(prompted, { type: "concede", playerId: "outsider" });
  assert.equal(invalid.error?.code, "invalid_command");
  const result = submitCommand(prompted, { type: "concede", playerId: "b" });
  assert.equal(result.error, null);
  assert.equal(result.state.phase, "ended");
  assert.equal(result.state.winnerPlayerId, "a");
  assert.equal(result.state.prompt, null);
  assert.equal(result.state.outstandingTasks.length, 0);
  assert.equal(result.events.filter(event => event.type === "game-ended").length, 1);
  assert.equal(isGameProjection(projectGame(result.state, "b")), true);
  assert.equal(submitCommand(result.state, {
    type: "concede", playerId: "a"
  }).error?.code, "game_ended");
});

test("wire commands validate targets strictly without trusting client actor IDs", () => {
  const envelope = {
    type: "command", requestId: "r", commandId: "c", expectedVersion: 1,
    command: { type: "play-card", instanceId: "strike", targets: [{ kind: "object", objectId: "target" }] }
  };
  assert.equal(isClientMessage(envelope), true);
  assert.equal(isClientMessage({
    ...envelope, command: { ...envelope.command, playerId: "b" }
  }), false);
  assert.equal(isClientMessage({
    ...envelope, command: { ...envelope.command, targets: [{ kind: "object", objectId: "target", hidden: true }] }
  }), false);
  assert.equal(isCommand({ type: "concede", playerId: "b" }), true);
});
