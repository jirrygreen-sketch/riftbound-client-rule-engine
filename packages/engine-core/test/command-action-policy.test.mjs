import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredGame, projectGame, submitCommand } from "../dist/index.js";
import { isGameProjection } from "@riftbound/protocol";

function fixture({ withTarget = true } = {}) {
  return createConfiguredGame({
    players: [
      {
        id: "a", name: "Alice", startingHand: [
          { instanceId: "a:judge", cardId: "judge" },
          { instanceId: "a:token", cardId: "token" },
          { instanceId: "a:strike", cardId: "strike" },
          { instanceId: "a:unit", cardId: "unit" },
          { instanceId: "a:score", cardId: "score" },
          { instanceId: "a:expensive", cardId: "expensive" }
        ]
      },
      {
        id: "b", name: "Bob",
        ...(withTarget ? { board: [{ instanceId: "b:unit", cardId: "unit" }] } : {})
      }
    ],
    cards: [
      {
        id: "judge", name: "Judge Required", cost: 1, types: ["spell"],
        effect: { kind: "judge-required", reason: "official text not modeled" }
      },
      { id: "token", name: "Token", cost: 0, types: ["token"] },
      {
        id: "strike", name: "Strike", cost: 1, types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] }
      },
      { id: "unit", name: "Unit", cost: 1, types: ["unit"], health: 4 },
      {
        id: "score", name: "Score", cost: 0, types: ["spell"],
        effect: { kind: "gain-points", amount: 1,
          targets: [{ kind: "player", playerId: "a" }] }
      },
      { id: "expensive", name: "Expensive", cost: 3, types: ["unit"] }
    ],
    rules: { startingEnergy: 2, targetPoints: 8, drawOnTurnStart: false }
  });
}

function getAction(state, id, viewerId = "a") {
  const projection = projectGame(state, viewerId);
  assert.equal(isGameProjection(projection), true);
  const action = projection.actionOptions.actions.find(candidate => candidate.id === id);
  assert.ok(action, `missing action ${id}`);
  return action;
}

function assertRejected(state, command, code) {
  const snapshot = structuredClone(state);
  const result = submitCommand(state, command);
  assert.equal(result.error?.code, code);
  assert.equal(result.state, state);
  assert.deepEqual(result.state, snapshot);
  assert.deepEqual(result.events, []);
  return result;
}

test("direct disabled judge or unsupported play cannot spend energy, move a card, or create a prompt", () => {
  const state = fixture();
  for (const [instanceId, reason, code] of [
    ["a:judge", "judge-required", "judge_required"],
    ["a:token", "unsupported-card-type", "invalid_command"]
  ]) {
    const action = getAction(state, `play:${instanceId}`);
    assert.equal(action.enabled, false);
    assert.equal(action.blockedReason, reason);
    assertRejected(state, {
      type: "play-card", playerId: "a", instanceId
    }, code);
    assert.equal(state.prompt, null);
    assert.deepEqual(state.outstandingTasks, []);
    assert.equal(state.players[0].energy, 2);
    assert.equal(state.objects[instanceId].zone, "hand");
  }
});

test("target requirement and public option membership gate the direct command before payment", () => {
  const state = fixture();
  const action = getAction(state, "play:a:strike");
  assert.equal(action.enabled, true);
  assert.deepEqual(action.targetPolicy, {
    minTargets: 1, maxTargets: 1,
    options: [{ kind: "object", objectId: "b:unit" }]
  });
  for (const targets of [
    undefined,
    [],
    [{ kind: "object", objectId: "a:strike" }],
    [{ kind: "object", objectId: "not-present" }],
    [{ kind: "player", playerId: "b" }],
    [{ kind: "object", objectId: "b:unit" }, { kind: "object", objectId: "b:unit" }]
  ]) {
    assertRejected(state, {
      type: "play-card", playerId: "a", instanceId: "a:strike",
      ...(targets === undefined ? {} : { targets })
    }, "invalid_command");
  }
  assert.equal(state.players[0].energy, 2);
  assert.equal(state.objects["a:strike"].zone, "hand");
  assert.equal(state.objects["b:unit"].damage, 0);
  assert.equal(state.prompt, null);
});

test("no legal target disables a dynamic card and the raw command cannot bypass it", () => {
  const state = fixture({ withTarget: false });
  const action = getAction(state, "play:a:strike");
  assert.equal(action.enabled, false);
  assert.equal(action.blockedReason, "no-legal-target");
  assertRejected(state, {
    type: "play-card", playerId: "a", instanceId: "a:strike"
  }, "invalid_command");
});

test("valid public target and target-free plays still resolve", () => {
  const state = fixture();
  const target = getAction(state, "play:a:strike").targetPolicy.options[0];
  const struck = submitCommand(state, {
    type: "play-card", playerId: "a", instanceId: "a:strike",
    targets: [target]
  });
  assert.equal(struck.error, null);
  assert.equal(struck.state.objects["b:unit"].damage, 2);
  assert.equal(struck.state.players[0].energy, 1);
  assert.equal(struck.state.objects["a:strike"].zone, "discard");
  assert.equal(struck.state.prompt, null);

  const unit = getAction(struck.state, "play:a:unit");
  assert.deepEqual(unit.targetPolicy, { minTargets: 0, maxTargets: 0, options: [] });
  const played = submitCommand(struck.state, { ...unit.command, playerId: "a" });
  assert.equal(played.error, null);
  assert.equal(played.state.objects["a:unit"].zone, "board");
  assert.equal(played.state.players[0].energy, 0);

  const score = getAction(played.state, "play:a:score");
  const scored = submitCommand(played.state, { ...score.command, playerId: "a" });
  assert.equal(scored.error, null);
  assert.equal(scored.state.players[0].score, 1);
  assert.equal(scored.state.objects["a:score"].zone, "discard");
});

test("reject forged actor, card identity, out-of-turn and unavailable action points", () => {
  const state = fixture();
  assertRejected(state, {
    type: "play-card", playerId: "b", instanceId: "a:unit"
  }, "not_your_turn");
  assertRejected(state, {
    type: "play-card", playerId: "a", instanceId: "missing"
  }, "card_not_found");
  assertRejected(state, {
    type: "play-card", playerId: "a", instanceId: "a:expensive"
  }, "not_enough_mana");
  assertRejected(state, {
    type: "play-card", playerId: "a", instanceId: "a:unit",
    targets: [{ kind: "object", objectId: "b:unit" }]
  }, "invalid_command");

  const mismatched = structuredClone(state);
  mismatched.objects["a:unit"].cardId = "judge";
  assert.equal(projectGame(mismatched, "a").actionOptions.actions.find(action =>
    action.id === "play:a:unit").enabled, false);
  assertRejected(mismatched, {
    type: "play-card", playerId: "a", instanceId: "a:unit"
  }, "card_not_found");

  const noPriority = structuredClone(state);
  noPriority.priorityPlayerId = "b";
  assert.deepEqual(projectGame(noPriority, "a").actionOptions.actions.map(action => action.id),
    ["concede"]);
  assertRejected(noPriority, { type: "pass", playerId: "a" }, "invalid_command");
  assertRejected(noPriority, {
    type: "play-card", playerId: "a", instanceId: "a:unit"
  }, "invalid_command");

  const onCombat = structuredClone(state);
  onCombat.turnPhase = "combat";
  assertRejected(onCombat, { type: "pass", playerId: "a" }, "invalid_command");
  assertRejected(onCombat, {
    type: "play-card", playerId: "a", instanceId: "a:unit"
  }, "invalid_command");

  const withTask = structuredClone(state);
  withTask.outstandingTasks.push({
    id: "task:pending", sourceCardId: "strike", sourceObjectId: "a:strike",
    sourcePlayerId: "a", reason: "resolve-effect", optional: false
  });
  assertRejected(withTask, { type: "pass", playerId: "a" }, "invalid_command");
  assertRejected(withTask, {
    type: "play-card", playerId: "a", instanceId: "a:unit"
  }, "invalid_command");
});

test("pass, prompt owner, and concession permissions remain intact", () => {
  const state = fixture();
  const passed = submitCommand(state, { type: "pass", playerId: "a" });
  assert.equal(passed.error, null);
  assert.equal(passed.state.activePlayerId, "b");
  assertRejected(passed.state, { type: "pass", playerId: "a" }, "not_your_turn");

  const prompted = structuredClone(state);
  prompted.prompt = {
    id: "prompt:legacy", ownerPlayerId: "a", playerId: "a",
    stateVersion: state.version, status: "pending", taskId: "task:legacy",
    reason: "resolve-effect", optional: false,
    options: [{ id: "target:object:b:unit", label: "Unit" }]
  };
  prompted.outstandingTasks.push({
    id: "task:legacy", sourceCardId: "strike", sourceObjectId: "a:strike",
    sourcePlayerId: "a", reason: "resolve-effect", optional: false,
    effect: { kind: "damage", amount: 2, targets: [] },
    targetChoices: [{ kind: "object", objectId: "b:unit" }],
    requiresTargetChoice: true
  });
  assertRejected(prompted, { type: "pass", playerId: "a" }, "prompt_required");
  assertRejected(prompted, {
    type: "play-card", playerId: "a", instanceId: "a:unit"
  }, "prompt_required");
  assertRejected(prompted, {
    type: "respond-to-prompt", playerId: "b",
    promptId: "prompt:legacy", optionId: "target:object:b:unit"
  }, "not_your_turn");
  const resolved = submitCommand(prompted, {
    type: "respond-to-prompt", playerId: "a",
    promptId: "prompt:legacy", optionId: "target:object:b:unit"
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.state.objects["b:unit"].damage, 2);
  const conceded = submitCommand(prompted, { type: "concede", playerId: "b" });
  assert.equal(conceded.error, null);
  assert.equal(conceded.state.phase, "ended");
  assert.equal(conceded.state.winnerPlayerId, "a");
  assert.equal(conceded.state.prompt, null);
});
