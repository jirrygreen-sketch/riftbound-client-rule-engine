import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfiguredGame,
  projectGame,
  reconcileLegacyPrompt,
  submitCommand
} from "../dist/index.js";

function dynamicGainGame({ cost = 2 } = {}) {
  return createConfiguredGame({
    players: [
      {
        id: "a",
        name: "Alice",
        startingHand: [{ instanceId: "a:rally", cardId: "rally" }]
      },
      {
        id: "b",
        name: "Bob",
        board: [{ instanceId: "b:unit", cardId: "unit" }]
      }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 0, types: ["unit"], health: 5 },
      {
        id: "rally",
        name: "Rally",
        cost,
        types: ["spell"],
        effect: { kind: "gain-points", amount: 1, targets: [] }
      }
    ],
    rules: { startingEnergy: cost, drawOnTurnStart: false }
  });
}

function legacyDamageGame() {
  return createConfiguredGame({
    players: [
      {
        id: "a",
        name: "Alice",
        startingHand: [{ instanceId: "a:strike", cardId: "strike" }]
      },
      {
        id: "b",
        name: "Bob",
        board: [
          { instanceId: "b:legal", cardId: "unit" },
          { instanceId: "b:stale", cardId: "unit" }
        ]
      }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 0, types: ["unit"], health: 5 },
      {
        id: "strike",
        name: "Strike",
        cost: 2,
        types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] }
      }
    ],
    rules: { startingEnergy: 2, drawOnTurnStart: false }
  });
}

function putSourceInChain(state, sourceId = "a:strike") {
  const player = state.players.find(candidate => candidate.id === "a");
  player.hand = player.hand.filter(card => card.instanceId !== sourceId);
  player.chain.push(sourceId);
  state.objects[sourceId].zone = "chain";
}

function putPromptedTask(state, task, options) {
  state.outstandingTasks.push(task);
  state.prompt = {
    id: `prompt:${task.id}`,
    ownerPlayerId: "a",
    playerId: "a",
    stateVersion: state.version,
    status: "pending",
    taskId: task.id,
    reason: task.reason,
    optional: task.optional,
    options
  };
}

function promptOption(target) {
  const id = target.kind === "player"
    ? `target:player:${target.playerId}`
    : `target:object:${target.objectId}`;
  return { id, label: id };
}

test("real dynamic gain-points API exposes player targets and resolves once", () => {
  const state = dynamicGainGame();
  const played = submitCommand(state, {
    type: "play-card",
    playerId: "a",
    instanceId: "a:rally"
  });
  assert.equal(played.error, null);
  assert.equal(played.state.players[0].energy, 0);
  assert.deepEqual(played.state.prompt.options.map(option => option.id), [
    "target:player:a",
    "target:player:b"
  ]);
  assert.deepEqual(projectGame(played.state, "a").prompt.options.map(option => option.id), [
    "target:player:a",
    "target:player:b"
  ]);
  const answered = submitCommand(played.state, {
    type: "respond-to-prompt",
    playerId: "a",
    promptId: played.state.prompt.id,
    optionId: "target:player:a",
    stateVersion: played.state.prompt.stateVersion
  });
  assert.equal(answered.error, null);
  assert.equal(answered.state.players[0].score, 1);
  assert.equal(answered.state.players[1].score, 0);
  assert.equal(answered.state.prompt, null);
  assert.deepEqual(answered.state.outstandingTasks, []);
  assert.deepEqual(answered.state.players[0].chain, []);
  assert.deepEqual(answered.state.players[0].discard, ["a:rally"]);
  assert.equal(answered.events.filter(event => event.type === "points-gained").length, 1);
  assert.equal(answered.events.filter(event => event.type === "points-gained")[0].targetPlayerId, "a");

  const repeated = submitCommand(answered.state, {
    type: "respond-to-prompt",
    playerId: "a",
    promptId: played.state.prompt.id,
    optionId: "target:player:a",
    stateVersion: played.state.prompt.stateVersion
  });
  assert.equal(repeated.error?.code, "prompt_not_found");
  assert.equal(repeated.state.players[0].score, 1);
  assert.equal(repeated.events.length, 0);
});

test("reconcile seam ignores only later-invalid selected targets and preserves cost and zone", () => {
  const state = legacyDamageGame();
  putSourceInChain(state);
  state.players[0].energy = 0;
  state.players[1].board = state.players[1].board.filter(objectId => objectId !== "b:stale");
  state.players[1].hand.push({ instanceId: "b:stale", cardId: "unit" });
  state.objects["b:stale"].zone = "hand";
  const task = {
    id: "task:legacy:selected",
    sourceCardId: "strike",
    sourceObjectId: "a:strike",
    sourcePlayerId: "a",
    reason: "resolve-effect",
    optional: false,
    effect: {
      kind: "damage",
      amount: 2,
      targets: [
        { kind: "object", objectId: "b:legal" },
        { kind: "object", objectId: "b:stale" }
      ]
    },
    targetChoices: [
      { kind: "object", objectId: "b:legal" },
      { kind: "object", objectId: "b:stale" }
    ],
    requiresTargetChoice: false
  };
  putPromptedTask(state, task, task.effect.targets.map(promptOption));

  const before = structuredClone(state);
  const reconciled = reconcileLegacyPrompt(state);
  assert.equal(reconciled.status, "resolved");
  assert.equal(reconciled.changed, true);
  assert.deepEqual(state, before, "reconcile is pure from the caller's perspective");
  assert.equal(reconciled.state.objects["b:legal"].damage, 2);
  assert.equal(reconciled.state.objects["b:stale"].damage, 0);
  assert.equal(reconciled.state.prompt, null);
  assert.deepEqual(reconciled.state.outstandingTasks, []);
  assert.deepEqual(reconciled.state.players[0].chain, []);
  assert.deepEqual(reconciled.state.players[0].discard, ["a:strike"]);
  assert.equal(reconciled.state.players[0].energy, 0);
  assert.deepEqual(
    reconciled.events.map(event => event.type),
    ["damage-dealt", "task-resolved"]
  );
});

test("unselected no-legal-target and malformed legacy tasks remain visible judge-required", () => {
  const state = dynamicGainGame({ cost: 0 });
  const task = {
    id: "task:legacy:no-recipient",
    sourceCardId: "rally",
    sourceObjectId: "a:rally",
    sourcePlayerId: "a",
    reason: "resolve-effect",
    optional: false,
    effect: { kind: "gain-points", amount: 1, targets: [] },
    targetChoices: [{ kind: "object", objectId: "b:unit" }],
    requiresTargetChoice: true
  };
  putPromptedTask(state, task, [
    { id: "target:object:b:unit", label: "stale object" }
  ]);
  const before = structuredClone(state);
  const reconciled = reconcileLegacyPrompt(state);
  assert.equal(reconciled.status, "judge-required");
  assert.equal(reconciled.changed, true);
  assert.deepEqual(state, before);
  assert.equal(reconciled.state.prompt.reason, "judge-required");
  assert.deepEqual(reconciled.state.prompt.options.map(option => option.id), ["judge-required"]);
  assert.equal(reconciled.state.outstandingTasks[0].disposition, "judge-required");
  assert.equal(reconciled.state.players[0].score, 0);
  assert.equal(reconciled.state.objects["a:rally"].zone, "hand");
  assert.equal(projectGame(reconciled.state, "a").prompt.options[0].id, "judge-required");
  assert.equal(
    projectGame(reconciled.state, "a").actionOptions.actions.find(action =>
      action.command.optionId === "judge-required"
    ).blockedReason,
    "judge-required"
  );

  const malformed = dynamicGainGame({ cost: 0 });
  putPromptedTask(malformed, {
    ...task,
    id: "task:legacy:malformed",
    effect: { kind: "future-unknown", payload: "do not execute" },
    targetChoices: [{ kind: "player", playerId: "a" }]
  }, [{ id: "target:player:a", label: "untrusted" }]);
  const malformedResult = reconcileLegacyPrompt(malformed);
  assert.equal(malformedResult.status, "judge-required");
  assert.equal(malformedResult.state.prompt.reason, "judge-required");
  assert.equal(malformedResult.state.players[0].score, 0);
});

test("expired command boundary repairs a pending task without mutating the input bytes", () => {
  const state = dynamicGainGame({ cost: 0 });
  const task = {
    id: "task:legacy:expired",
    sourceCardId: "rally",
    sourceObjectId: "a:rally",
    sourcePlayerId: "a",
    reason: "resolve-effect",
    optional: false,
    effect: { kind: "gain-points", amount: 1, targets: [] },
    targetChoices: [{ kind: "object", objectId: "b:unit" }],
    requiresTargetChoice: true
  };
  putPromptedTask(state, task, [promptOption(task.targetChoices[0])]);
  state.prompt.stateVersion -= 1;
  const before = structuredClone(state);
  const result = submitCommand(state, {
    type: "respond-to-prompt",
    playerId: "a",
    promptId: state.prompt.id,
    optionId: "target:object:b:unit",
    stateVersion: before.prompt.stateVersion
  });
  assert.equal(result.error?.code, "prompt_expired");
  assert.deepEqual(state, before);
  assert.equal(result.state.prompt.reason, "judge-required");
  assert.equal(result.state.outstandingTasks[0].disposition, "judge-required");
  assert.equal(result.state.players[0].score, 0);
});

function restoredEffect({ kind = "damage", targets = [], fixed = [], optional = false,
  requiresTargetChoice = false, choices = targets, prompt = true, effect,
  sourceCardId, sourceObjectId, sourcePlayerId, reason = "resolve-effect" } = {}) {
  const state = legacyDamageGame();
  state.cards.strike.effect = { kind, amount: 2, targets: fixed };
  putSourceInChain(state);
  state.players[0].energy = 0;
  const task = {
    id: "task:legacy:authority", sourceCardId: sourceCardId ?? "strike",
    sourceObjectId: sourceObjectId ?? "a:strike", sourcePlayerId: sourcePlayerId ?? "a",
    reason, optional, effect: effect ?? { kind, amount: 2, targets },
    targetChoices: choices, requiresTargetChoice
  };
  if (prompt) {
    const options = requiresTargetChoice
      ? choices.map(promptOption).concat(optional
        ? [{ id: "resolve", label: "Resolve" }, { id: "skip", label: "Decline" }]
        : [])
      : [{ id: "resolve", label: "Resolve" }, ...(optional ? [{ id: "skip", label: "Decline" }] : [])];
    putPromptedTask(state, task, options);
  } else {
    state.outstandingTasks.push(task);
  }
  return state;
}

const objectTarget = objectId => ({ kind: "object", objectId });
const playerTarget = playerId => ({ kind: "player", playerId });
const answer = (state, optionId) => submitCommand(state, {
  type: "respond-to-prompt", playerId: "a", promptId: state.prompt.id, optionId
});
const ownerOptions = state => projectGame(state, "a").prompt?.options.map(option => option.id) ?? [];

function assertPaidPending(state) {
  assert.equal(state.players[0].energy, 0);
  assert.deepEqual(state.players[0].chain, ["a:strike"]);
  assert.deepEqual(state.players[0].discard, []);
  assert.equal(state.objects["a:strike"].zone, "chain");
}

function assertRuling(state, before) {
  const result = reconcileLegacyPrompt(state);
  assert.deepEqual(state, before, "reconciliation must not mutate its input");
  assert.equal(result.status, "judge-required");
  assert.equal(result.state.outstandingTasks[0].disposition, "judge-required");
  assert.equal(result.state.prompt.reason, "judge-required");
  assert.deepEqual(ownerOptions(result.state), ["judge-required"]);
  assert.equal(projectGame(result.state, "a").actionOptions.actions.find(action =>
    action.command.optionId === "judge-required")?.blockedReason, "judge-required");
  assertPaidPending(result.state);
  assert.equal(result.events.some(event => event.type === "damage-dealt" ||
    event.type === "points-gained" || event.type === "task-resolved"), false);
  return result;
}

test("optional printed fixed target awaits consent across reconcile and expired skip", () => {
  const fixed = objectTarget("b:legal");
  const state = restoredEffect({ fixed: [fixed], targets: [fixed], choices: [fixed], optional: true });
  const before = structuredClone(state);
  const reconciled = reconcileLegacyPrompt(state);
  assert.deepEqual(state, before);
  assert.equal(reconciled.status, "unchanged");
  assert.deepEqual(reconciled.events, []);
  assertPaidPending(reconciled.state);
  assert.equal(reconciled.state.objects["b:legal"].damage, 0);
  assert.deepEqual(ownerOptions(reconciled.state), ["resolve", "skip"]);
  const declined = answer(reconciled.state, "skip");
  assert.equal(declined.error, null);
  assert.equal(declined.state.objects["b:legal"].damage, 0);
  assert.deepEqual(declined.events.map(event => event.type), ["prompt-answered", "trigger-skipped"]);
  assert.deepEqual(declined.state.players[0].discard, ["a:strike"]);
  const accepted = answer(reconciled.state, "resolve");
  assert.equal(accepted.error, null);
  assert.equal(accepted.state.objects["b:legal"].damage, 2);
  assert.equal(accepted.events.filter(event => event.type === "damage-dealt").length, 1);
  assert.equal(reconcileLegacyPrompt(accepted.state).events.length, 0);
  state.prompt.stateVersion -= 1;
  const staleBefore = structuredClone(state);
  const expired = answer(state, "skip");
  assert.equal(expired.error?.code, "prompt_expired");
  assert.equal(expired.state, state);
  assert.deepEqual(state, staleBefore);
  assert.deepEqual(expired.events, []);
  assert.equal(expired.state.objects["b:legal"].damage, 0);
});

test("optional previously selected instructions do not override a decline", () => {
  const legal = objectTarget("b:legal");
  const stale = objectTarget("b:stale");
  const state = restoredEffect({ targets: [legal, stale], choices: [legal, stale], optional: true });
  state.players[1].board = state.players[1].board.filter(id => id !== "b:stale");
  state.players[1].hand.push({ instanceId: "b:stale", cardId: "unit" });
  state.objects["b:stale"].zone = "hand";
  const result = reconcileLegacyPrompt(state);
  assert.equal(result.status, "unchanged");
  assert.deepEqual(result.events, []);
  assertPaidPending(result.state);
  assert.equal(result.state.objects["b:legal"].damage, 0);
  assert.deepEqual(ownerOptions(result.state), ["resolve", "skip"]);
  const skip = answer(result.state, "skip");
  assert.equal(skip.error, null);
  assert.equal(skip.state.objects["b:legal"].damage, 0);
  const resolve = answer(result.state, "resolve");
  assert.equal(resolve.error, null);
  assert.equal(resolve.state.objects["b:legal"].damage, 2);
  assert.equal(resolve.state.objects["b:stale"].damage, 0);
  assert.deepEqual(resolve.events.map(event => event.type), ["prompt-answered", "damage-dealt"]);
});

test("optional orphan restores an explicit choice instead of auto-resolving", () => {
  const fixed = objectTarget("b:legal");
  const state = restoredEffect({ fixed: [fixed], targets: [fixed], choices: [fixed], optional: true, prompt: false });
  const before = structuredClone(state);
  const result = reconcileLegacyPrompt(state);
  assert.deepEqual(state, before);
  assert.equal(result.state.objects["b:legal"].damage, 0);
  assertPaidPending(result.state);
  assert.deepEqual(ownerOptions(result.state), ["resolve", "skip"]);
  assert.deepEqual(result.events.map(event => event.type), ["prompt-created"]);
  const skipped = answer(result.state, "skip");
  assert.equal(skipped.error, null);
  assert.equal(skipped.state.objects["b:legal"].damage, 0);
  assert.deepEqual(reconcileLegacyPrompt(skipped.state).events, []);
});

test("unknown source and mismatched printed effect require judge, not fallback source", () => {
  const legal = objectTarget("b:legal");
  const unknown = restoredEffect({ targets: [legal], choices: [legal],
    sourceCardId: "not-a-card", sourceObjectId: "not-an-object", sourcePlayerId: "not-a-player" });
  const ruling = assertRuling(unknown, structuredClone(unknown));
  assert.equal(ruling.state.objects["b:legal"].damage, 0);
  assert.equal(reconcileLegacyPrompt(ruling.state).changed, false);
  assert.deepEqual(reconcileLegacyPrompt(ruling.state).events, []);

  const mismatch = restoredEffect({ kind: "gain-points", targets: [legal], choices: [legal],
    effect: { kind: "damage", amount: 7, targets: [legal] } });
  assertRuling(mismatch, structuredClone(mismatch));
  assert.equal(reconcileLegacyPrompt(mismatch).state.objects["b:legal"].damage, 0);
});

test("malformed amounts and unknown effect kinds fail closed with and without prompts", () => {
  for (const amount of [-2, "2", Number.MAX_SAFE_INTEGER + 1]) {
    for (const prompted of [true, false]) {
      const state = restoredEffect({ kind: "gain-points", prompt: prompted,
        targets: [playerTarget("a")], choices: [playerTarget("a")],
        effect: { kind: "gain-points", amount, targets: [playerTarget("a")] } });
      const before = structuredClone(state);
      const result = assertRuling(state, before);
      assert.equal(result.state.players[0].score, 0);
      if (prompted) {
        const invalid = answer(state, "resolve");
        assert.notEqual(invalid.error, null);
        assert.equal(invalid.state, state);
        assert.deepEqual(invalid.events, []);
        assert.deepEqual(state, before);
      }
    }
  }
  for (const prompted of [true, false]) {
    const state = restoredEffect({ prompt: prompted, targets: [objectTarget("b:legal")],
      choices: [objectTarget("b:legal")],
      effect: { kind: "future-unknown", amount: 2, targets: [objectTarget("b:legal")] } });
    const result = assertRuling(state, structuredClone(state));
    assert.equal(result.state.objects["b:legal"].damage, 0);
  }
});

test("optional unselected with no legal target preserves skip and forbids invented resolve", () => {
  const state = restoredEffect({ kind: "gain-points", targets: [], choices: [objectTarget("b:legal")],
    optional: true, requiresTargetChoice: true });
  const before = structuredClone(state);
  const reconciled = reconcileLegacyPrompt(state);
  assert.equal(reconciled.status, "unchanged");
  assert.deepEqual(state, before);
  assert.deepEqual(ownerOptions(reconciled.state), ["skip"]);
  assertPaidPending(reconciled.state);
  const invalid = answer(reconciled.state, "resolve");
  assert.equal(invalid.error?.code, "invalid_prompt_answer");
  assert.equal(invalid.state, reconciled.state);
  assert.deepEqual(invalid.events, []);
  const declined = answer(reconciled.state, "skip");
  assert.equal(declined.error, null);
  assert.equal(declined.state.players[0].score, 0);
  assert.deepEqual(declined.events.map(event => event.type), ["prompt-answered", "trigger-skipped"]);
});

test("unselected contradictory targets cannot execute or override saved choice", () => {
  const state = restoredEffect({ kind: "gain-points", targets: [playerTarget("a")],
    choices: [playerTarget("b")], requiresTargetChoice: true });
  assertRuling(state, structuredClone(state));
  assert.deepEqual(state.players.map(player => player.score), [0, 0]);
  const invalid = answer(state, "target:player:b");
  assert.notEqual(invalid.error, null);
  assert.equal(invalid.state, state);
  assert.deepEqual(invalid.events, []);
});

test("mandatory printed fixed target remains a one-shot positive control", () => {
  const fixed = objectTarget("b:legal");
  const state = restoredEffect({ fixed: [fixed], targets: [fixed], choices: [fixed], optional: false });
  const result = reconcileLegacyPrompt(state);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.events.map(event => event.type), ["damage-dealt", "task-resolved"]);
  assert.equal(result.state.objects["b:legal"].damage, 2);
  assert.equal(result.state.players[0].energy, 0);
  assert.deepEqual(result.state.players[0].discard, ["a:strike"]);
  assert.equal(reconcileLegacyPrompt(result.state).changed, false);
  assert.deepEqual(reconcileLegacyPrompt(result.state).events, []);
});

test("selected mixed stale targets execute legal subset once without fallback", () => {
  const legal = objectTarget("b:legal");
  const stale = objectTarget("b:stale");
  const state = restoredEffect({ targets: [legal, stale], choices: [legal, stale] });
  state.players[1].board = state.players[1].board.filter(id => id !== "b:stale");
  state.players[1].hand.push({ instanceId: "b:stale", cardId: "unit" });
  state.objects["b:stale"].zone = "hand";
  const result = reconcileLegacyPrompt(state);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.events.map(event => event.type), ["damage-dealt", "task-resolved"]);
  assert.equal(result.state.objects["b:legal"].damage, 2);
  assert.equal(result.state.objects["b:stale"].damage, 0);
  assert.equal(result.state.players[0].energy, 0);
  assert.deepEqual(result.state.players[0].discard, ["a:strike"]);
  assert.deepEqual(reconcileLegacyPrompt(result.state).events, []);
});
