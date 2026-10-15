import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredGame, createInitialGame, projectGame, submitCommand } from "../dist/index.js";
import { isGameProjection } from "@riftbound/protocol";

function fixture() {
  return createConfiguredGame({
    players: [
      { id: "a", name: "Alice", startingHand: [
        { instanceId: "a:strike", cardId: "strike" },
        { instanceId: "a:hidden", cardId: "unit" }
      ] },
      { id: "b", name: "Bob", startingHand: [
        { instanceId: "b:hidden", cardId: "unit" }
      ], board: [
        { instanceId: "b:public:with:colons", cardId: "unit" },
        { instanceId: "b:stale", cardId: "unit" }
      ] }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 0, types: ["unit"], health: 5 },
      { id: "strike", name: "Strike", cost: 1, types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] } }
    ],
    rules: { startingEnergy: 2, drawOnTurnStart: false }
  });
}

function withPrompt(state, choices, options = choices.map(target => ({
  id: `target:${target.kind}:${target.kind === "object" ? target.objectId : target.playerId}`,
  label: target.kind === "object" ? `Choice ${target.objectId}` : `Choice ${target.playerId}`
})), { optional = false, effect = { kind: "damage", amount: 2, targets: [] } } = {}) {
  const task = {
    id: "task:legacy", sourceCardId: "strike", sourceObjectId: "a:strike",
    sourcePlayerId: "a", reason: "resolve-effect", optional, effect,
    targetChoices: choices, requiresTargetChoice: true
  };
  state.outstandingTasks.push(task);
  state.prompt = {
    id: "prompt:legacy", ownerPlayerId: "a", playerId: "a",
    stateVersion: state.version, status: "pending", taskId: task.id,
    reason: task.reason, optional, options
  };
  return state;
}

const respond = (optionId, playerId = "a") => ({
  type: "respond-to-prompt", playerId, promptId: "prompt:legacy", optionId
});
const actions = projection => projection.actionOptions.actions.map(action => action.command.optionId ?? action.id);

function assertAtomicRejection(state, optionId, code = "invalid_prompt_answer") {
  const before = structuredClone(state);
  const result = submitCommand(state, respond(optionId));
  assert.equal(result.error?.code, code);
  assert.equal(result.state, state);
  assert.deepEqual(result.state, before);
  assert.deepEqual(result.events, []);
  assert.deepEqual(state.eventLog, before.eventLog);
  assert.deepEqual(state.players, before.players);
  assert.deepEqual(state.objects, before.objects);
  assert.deepEqual(state.outstandingTasks, before.outstandingTasks);
  assert.deepEqual(state.prompt, before.prompt);
  return result;
}

function assertSafeProjection(state, forbiddenIds = []) {
  const owner = projectGame(state, "a");
  const opponent = projectGame(state, "b");
  const spectator = projectGame(state, null);
  for (const projection of [owner, opponent, spectator]) {
    assert.equal(isGameProjection(projection), true, "projection must remain valid wire data");
  }
  for (const projection of [owner, spectator]) {
    const serialized = JSON.stringify(projection);
    for (const id of forbiddenIds) {
      assert.equal(serialized.includes(id), false, `hidden UID ${id} in projection`);
    }
  }
  assert.equal(opponent.prompt, null);
  assert.deepEqual(actions(opponent), ["concede"]);
  assert.deepEqual(actions(spectator), []);
  return owner;
}

test("legacy hidden opponent hand target and its metadata never project or execute", () => {
  const hidden = "b:hidden";
  const id = `target:object:${hidden}`;
  const state = withPrompt(fixture(), [{ kind: "object", objectId: hidden }], [
    { id, label: `Private card ${hidden} — never leak this label` }
  ]);
  const owner = assertSafeProjection(state, [hidden, "Private card"]);
  assert.equal(owner.objects.some(object => object.objectId === hidden), false);
  assert.equal(actions(owner).includes(id), false);
  assert.equal(owner.prompt?.options.some(option => option.id === id) ?? false, false);
  assertAtomicRejection(state, id);
  assert.equal(state.objects[hidden].damage, 0);
  assert.equal(state.eventLog.some(event => JSON.stringify(event).includes(hidden)), false);
  const concede = submitCommand(state, { type: "concede", playerId: "b" });
  assert.equal(concede.error, null);
  assert.equal(concede.state.phase, "ended");
});

test("even owner hand is not a public damage target", () => {
  const hidden = "a:hidden";
  const state = withPrompt(fixture(), [{ kind: "object", objectId: hidden }]);
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.objects.some(object => object.objectId === hidden), true);
  assert.deepEqual(actions(owner).filter(value => value === `target:object:${hidden}`), []);
  assert.equal(owner.prompt?.options.some(option => option.id === `target:object:${hidden}`) ?? false, false);
  assertAtomicRejection(state, `target:object:${hidden}`);
});

test("forged choices and missing objects have no executable prompt answers", () => {
  for (const id of ["not-present", "b:hidden"]) {
    const state = withPrompt(fixture(), [{ kind: "object", objectId: id }], [
      { id: `target:object:${id}`, label: `metadata about ${id}` },
      { id: "target:object:forged", label: "metadata about forged" }
    ]);
    const owner = projectGame(state, "a");
    assert.equal(isGameProjection(owner), true);
    assert.equal(owner.prompt?.options.some(option => option.id.startsWith("target:")) ?? false, false);
    assert.equal(actions(owner).some(optionId => optionId.startsWith("target:")), false);
    for (const optionId of [`target:object:${id}`, "target:object:forged"]) {
      assertAtomicRejection(state, optionId);
    }
  }
});

test("public target moving to hand invalidates stale prompt without side effects", () => {
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:stale" }]);
  const id = "target:object:b:stale";
  assert.equal(projectGame(state, "a").prompt.options[0].id, id);
  state.players[1].board = state.players[1].board.filter(value => value !== "b:stale");
  state.players[1].hand.push({ instanceId: "b:stale", cardId: "unit" });
  state.objects["b:stale"].zone = "hand";
  const owner = assertSafeProjection(state, ["b:stale"]);
  assert.equal(owner.prompt?.options.some(option => option.id === id) ?? false, false);
  assert.equal(actions(owner).includes(id), false);
  assertAtomicRejection(state, id);
});

test("mixed and duplicate stored choices project only unique currently legal targets", () => {
  const valid = "b:public:with:colons";
  const id = `target:object:${valid}`;
  const choices = [
    { kind: "object", objectId: "b:hidden" },
    { kind: "object", objectId: valid },
    { kind: "object", objectId: "missing" },
    { kind: "object", objectId: "b:stale" },
    { kind: "object", objectId: "b:stale" }
  ];
  const state = withPrompt(fixture(), choices, [
    { id: "target:object:b:hidden", label: "Private b:hidden metadata" },
    { id, label: "Public choice with colon-delimited object ID" },
    { id: "target:object:missing", label: "missing" },
    { id: "target:object:b:stale", label: "duplicate choice must not resolve" },
    { id: "target:object:forged", label: "forged" }
  ]);
  const owner = assertSafeProjection(state, ["b:hidden"]);
  assert.deepEqual(owner.prompt.options.map(option => option.id), [id]);
  assert.deepEqual(actions(owner), ["concede", id]);
  for (const invalid of ["target:object:b:hidden", "target:object:missing", "target:object:b:stale", "target:object:forged"]) {
    assertAtomicRejection(state, invalid);
  }
  const result = submitCommand(state, respond(id));
  assert.equal(result.error, null);
  assert.equal(result.state.objects[valid].damage, 2);
  assert.equal(result.state.objects["b:hidden"].damage, 0);
  assert.deepEqual(result.events.map(event => event.type), ["prompt-answered", "damage-dealt"]);
  assert.equal(result.events.some(event => JSON.stringify(event).includes("b:hidden")), false);
  assert.equal(result.state.prompt, null);
});

test("a forged public target not in stored choices remains unanswerable", () => {
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:hidden" }], [
    { id: "target:object:b:hidden", label: "Hidden" },
    { id: "target:object:b:stale", label: "Not a stored target choice" }
  ]);
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.prompt, null);
  assert.deepEqual(actions(owner), ["concede"]);
  assertAtomicRejection(state, "target:object:b:stale");
});

test("valid legacy gain-points player choices still resolve, forged players cannot", () => {
  const game = fixture();
  // The restored task must agree with its actual source definition. A damage
  // card cannot authorize a saved gain-points task merely by naming a player.
  game.cards.strike.effect = { kind: "gain-points", amount: 2, targets: [] };
  const state = withPrompt(game, [
    { kind: "player", playerId: "a" }, { kind: "player", playerId: "no-such-player" }
  ], undefined, { effect: { kind: "gain-points", amount: 2, targets: [] } });
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.deepEqual(owner.prompt.options.map(option => option.id), ["target:player:a"]);
  assertAtomicRejection(state, "target:player:no-such-player");
  const result = submitCommand(state, respond("target:player:a"));
  assert.equal(result.error, null);
  assert.equal(result.state.players[0].score, 2);
  assert.equal(result.events.some(event => event.type === "points-gained" && event.targetPlayerId === "a"), true);
});

test("duplicate prompt options cannot be used even if their stored choice is legal", () => {
  const id = "target:object:b:stale";
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:stale" }], [
    { id, label: "duplicate 1" }, { id, label: "duplicate 2" }
  ]);
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.prompt?.options.some(option => option.id === id) ?? false, false);
  assertAtomicRejection(state, id);
});

test("orphaned target metadata without stored choices is not projected or actionable", () => {
  const state = withPrompt(fixture(), [], [
    { id: "target:object:b:hidden", label: "private b:hidden" }
  ]);
  state.outstandingTasks[0].requiresTargetChoice = false;
  const owner = assertSafeProjection(state, ["b:hidden"]);
  assert.equal(owner.prompt, null);
  assertAtomicRejection(state, "target:object:b:hidden");
});

test("a forged target prompt without requiresTargetChoice cannot bypass authorization", () => {
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:hidden" }]);
  state.outstandingTasks[0].requiresTargetChoice = false;
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.prompt, null);
  assert.deepEqual(actions(owner), ["concede"]);
  assertAtomicRejection(state, "target:object:b:hidden");
});

test("untrusted restored non-target metadata is not promoted into a target answer", () => {
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:stale" }]);
  state.outstandingTasks[0].requiresTargetChoice = false;
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.prompt, null);
  assert.deepEqual(actions(owner), ["concede"]);
  assertAtomicRejection(state, "target:object:b:stale");
});

test("an unrelated non-target prompt answer cannot bypass dynamic target validation", () => {
  const state = withPrompt(fixture(), [{ kind: "object", objectId: "b:hidden" }], [
    { id: "target:object:b:hidden", label: "Hidden" },
    { id: "confirm", label: "Unknown non-target answer" }
  ]);
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.equal(owner.prompt, null);
  assertAtomicRejection(state, "confirm");
});

test("optional decline and non-target resolve stay usable without executing hidden targets", () => {
  const hidden = "b:hidden";
  const id = `target:object:${hidden}`;
  const state = withPrompt(fixture(), [{ kind: "object", objectId: hidden }], [
    { id, label: `Private ${hidden}` },
    { id: "resolve", label: "Resolve trigger" },
    { id: "skip", label: "Decline trigger" }
  ], { optional: true });
  const owner = projectGame(state, "a");
  assert.equal(isGameProjection(owner), true);
  assert.deepEqual(owner.prompt.options.map(option => option.id), ["skip"]);
  assert.equal(actions(owner).includes(id), false);
  assertAtomicRejection(state, id);
  assertAtomicRejection(state, "resolve");
  const result = submitCommand(state, respond("skip"));
  assert.equal(result.error, null);
  assert.equal(result.state.prompt, null);
  assert.deepEqual(result.state.outstandingTasks, []);
  assert.equal(result.state.objects[hidden].damage, 0);
  assert.equal(result.events.some(event => JSON.stringify(event).includes(hidden)), false);
});

test("optional resolve can execute its one legal target and judge-required stays blocked", () => {
  const id = "target:object:b:stale";
  const optional = withPrompt(fixture(), [{ kind: "object", objectId: "b:stale" }], [
    { id, label: "Public" }, { id: "resolve", label: "Resolve trigger" },
    { id: "skip", label: "Decline" }
  ], { optional: true });
  const owner = projectGame(optional, "a");
  assert.equal(isGameProjection(owner), true);
  assert.deepEqual(owner.prompt.options.map(option => option.id), [id, "resolve", "skip"]);
  const resolved = submitCommand(optional, respond("resolve"));
  assert.equal(resolved.error, null);
  assert.equal(resolved.state.objects["b:stale"].damage, 2);

  const judge = fixture();
  judge.outstandingTasks.push({
    id: "task:legacy", sourceCardId: "strike", sourceObjectId: "a:strike",
    sourcePlayerId: "a", reason: "judge-required", optional: false,
    effect: { kind: "judge-required", reason: "needs ruling" }
  });
  judge.prompt = {
    id: "prompt:legacy", ownerPlayerId: "a", playerId: "a", stateVersion: judge.version,
    status: "pending", taskId: "task:legacy", reason: "judge-required", optional: false,
    options: [{ id: "judge-required", label: "Judge required" }]
  };
  const projected = projectGame(judge, "a");
  assert.equal(isGameProjection(projected), true);
  assert.equal(projected.actionOptions.actions.find(action => action.command.optionId === "judge-required")?.blockedReason, "judge-required");
  assertAtomicRejection(judge, "judge-required", "judge_required");
});

test("synthetic-demo prompt retains its optional trigger behavior", () => {
  const game = createInitialGame({ players: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }] });
  const played = submitCommand(game, { type: "play-card", playerId: "a", instanceId: "a:trigger-conquer" });
  assert.equal(played.error, null);
  assert.deepEqual(played.state.prompt.options.map(option => option.id), ["resolve", "skip"]);
  assert.equal(isGameProjection(projectGame(played.state, "a")), true);
  const skipped = submitCommand(played.state, {
    type: "respond-to-prompt", playerId: "a", promptId: played.state.prompt.id, optionId: "skip"
  });
  assert.equal(skipped.error, null);
  assert.equal(skipped.state.prompt, null);
});
