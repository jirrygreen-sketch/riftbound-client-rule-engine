// Regression: the default synthetic trigger's preselected player target must stay
// executable, while Foundation keeps its full source + object-target authorization.
//
// Root decision (contracts/server-regressions-root-decision.md): the wave123
// object-only damage filter must not reject the synthetic-demo default player
// target. `defaultTargets` short-circuits target-legality on SYNTHETIC_RULESET_ID
// exactly like its first branch, without dropping the source/effect/optional/once
// guards for Foundation/legacy.
import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNTHETIC_RULESET_ID,
  createConfiguredGame,
  createInitialGame,
  projectGame,
  reconcileLegacyPrompt,
  submitCommand
} from "../dist/index.js";
import { isGameProjection } from "@riftbound/protocol";

function playSyntheticTrigger() {
  const game = createInitialGame({
    players: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }]
  });
  const played = submitCommand(game, {
    type: "play-card",
    playerId: "a",
    instanceId: "a:trigger-conquer"
  });
  assert.equal(played.error, null);
  return played.state;
}

function foundationFixture() {
  return createConfiguredGame({
    players: [
      { id: "a", name: "Alice", startingHand: [{ instanceId: "a:strike", cardId: "strike" }] },
      { id: "b", name: "Bob", board: [{ instanceId: "b:stale", cardId: "unit" }] }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 0, types: ["unit"], health: 5 },
      { id: "strike", name: "Strike", cost: 1, types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] } }
    ],
    rules: { startingEnergy: 2, drawOnTurnStart: false }
  });
}

function foundationTask(choices) {
  return {
    id: "task:legacy",
    sourceCardId: "strike",
    sourceObjectId: "a:strike",
    sourcePlayerId: "a",
    reason: "resolve-effect",
    optional: false,
    effect: { kind: "damage", amount: 2, targets: [] },
    targetChoices: choices,
    requiresTargetChoice: true
  };
}

function withFoundationPrompt(state, choices, options) {
  const task = foundationTask(choices);
  state.outstandingTasks.push(task);
  state.prompt = {
    id: "prompt:legacy",
    ownerPlayerId: "a",
    playerId: "a",
    stateVersion: state.version,
    status: "pending",
    taskId: task.id,
    reason: task.reason,
    optional: false,
    options
  };
  return state;
}

test("default synthetic trigger resolves: opponent 20 -> 19 with damage-dealt once", () => {
  const state = playSyntheticTrigger();
  assert.equal(state.rules.rulesetId, SYNTHETIC_RULESET_ID);
  assert.deepEqual(state.prompt.options.map(option => option.id), ["resolve", "skip"]);
  assert.equal(isGameProjection(projectGame(state, "a")), true);

  const prompt = state.prompt;
  const result = submitCommand(state, {
    type: "respond-to-prompt",
    playerId: prompt.ownerPlayerId,
    promptId: prompt.id,
    optionId: "resolve",
    stateVersion: prompt.stateVersion
  });

  assert.equal(result.error, null);
  const damageEvents = result.events.filter(event => event.type === "damage-dealt");
  assert.equal(damageEvents.length, 1);
  assert.equal(damageEvents[0].targetPlayerId, "b");
  assert.equal(result.state.prompt, null);
  assert.deepEqual(result.state.outstandingTasks, []);

  const bob = projectGame(result.state, "a").players.find(player => player.id === "b");
  assert.equal(bob.life, 19, "server expectation remains life 19");
  assert.equal(result.state.players.find(player => player.id === "b").points, 19);
});

test("skip consumes the optional synthetic trigger without any damage", () => {
  const state = playSyntheticTrigger();
  const prompt = state.prompt;
  const result = submitCommand(state, {
    type: "respond-to-prompt",
    playerId: prompt.ownerPlayerId,
    promptId: prompt.id,
    optionId: "skip",
    stateVersion: prompt.stateVersion
  });

  assert.equal(result.error, null);
  assert.equal(result.events.some(event => event.type === "damage-dealt"), false);
  assert.equal(result.events.some(event => event.type === "points-gained"), false);
  assert.equal(result.state.prompt, null);
  assert.deepEqual(result.state.outstandingTasks, []);
  assert.equal(result.state.players.find(player => player.id === "b").points, 20);
  assert.equal(projectGame(result.state, "a").players.find(p => p.id === "b").life, 20);
});

test("replaying a response on the already-returned state consumes nothing further", () => {
  const state = playSyntheticTrigger();
  const prompt = state.prompt;
  const resolve = {
    type: "respond-to-prompt",
    playerId: prompt.ownerPlayerId,
    promptId: prompt.id,
    optionId: "resolve",
    stateVersion: prompt.stateVersion
  };
  const first = submitCommand(state, resolve);
  assert.equal(first.error, null);
  assert.equal(first.state.players.find(player => player.id === "b").points, 19);

  const after = first.state;
  const replay = submitCommand(after, resolve);
  assert.notEqual(replay.error, null);
  assert.equal(replay.error.code, "prompt_not_found");
  assert.equal(replay.state, after, "a rejected answer must not clone or mutate state");
  assert.deepEqual(replay.events, []);
  assert.equal(
    replay.state.players.find(player => player.id === "b").points,
    19,
    "the task may only be consumed once"
  );
  assert.equal(after.outstandingTasks.length, 0);
});

test("foundation still rejects an illegal player damage target with zero change", () => {
  const state = withFoundationPrompt(
    foundationFixture(),
    [{ kind: "player", playerId: "b" }],
    [{ id: "target:player:b", label: "Player b" }]
  );
  const before = structuredClone(state);
  const result = submitCommand(state, {
    type: "respond-to-prompt",
    playerId: "a",
    promptId: "prompt:legacy",
    optionId: "target:player:b"
  });

  assert.equal(result.error?.code, "invalid_prompt_answer");
  assert.equal(result.state, state);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.events, []);
  assert.equal(result.state.players[1].score, 0);
  assert.equal(result.state.objects["b:stale"].damage, 0);
  assert.equal(result.state.prompt.options[0].id, "target:player:b");
});

test("foundation surfaces an unprovable player damage target as judge-required, not damage", () => {
  const state = foundationFixture();
  state.outstandingTasks.push(foundationTask([{ kind: "player", playerId: "b" }]));

  const reconciled = reconcileLegacyPrompt(state);
  assert.equal(reconciled.status, "judge-required");
  assert.equal(reconciled.state.outstandingTasks[0].disposition, "judge-required");
  assert.equal(reconciled.state.prompt.reason, "judge-required");
  assert.deepEqual(reconciled.state.prompt.options.map(option => option.id), ["judge-required"]);
  assert.equal(reconciled.state.objects["b:stale"].damage, 0);
  assert.equal(reconciled.state.players[1].score, 0);
  assert.equal(
    reconciled.events.some(event => event.type === "damage-dealt" || event.type === "points-gained"),
    false
  );
});

test("foundation still executes a legal object damage target", () => {
  const state = withFoundationPrompt(
    foundationFixture(),
    [{ kind: "object", objectId: "b:stale" }],
    [{ id: "target:object:b:stale", label: "Choice b:stale" }]
  );
  const result = submitCommand(state, {
    type: "respond-to-prompt",
    playerId: "a",
    promptId: "prompt:legacy",
    optionId: "target:object:b:stale"
  });

  assert.equal(result.error, null);
  assert.equal(result.state.objects["b:stale"].damage, 2);
  assert.deepEqual(result.events.map(event => event.type), ["prompt-answered", "damage-dealt"]);
  assert.equal(result.state.prompt, null);
});
