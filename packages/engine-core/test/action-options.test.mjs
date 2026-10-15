import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfiguredGame,
  projectGame,
  submitCommand
} from "../dist/index.js";
import { isGameProjection } from "@riftbound/protocol";

const players = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" }
];

function fixture({ withTarget = true } = {}) {
  return createConfiguredGame({
    players: [
      {
        ...players[0],
        startingHand: [
          { instanceId: "a:unit", cardId: "unit" },
          { instanceId: "a:strike", cardId: "strike" },
          { instanceId: "a:judge", cardId: "judge" },
          { instanceId: "a:token", cardId: "token" },
          { instanceId: "a:score", cardId: "score" },
          { instanceId: "a:expensive", cardId: "expensive" }
        ]
      },
      {
        ...players[1],
        ...(withTarget
          ? { board: [{ instanceId: "b:unit", cardId: "unit" }] }
          : {})
      }
    ],
    cards: [
      { id: "unit", name: "Unit", cost: 1, types: ["unit"], health: 4 },
      {
        id: "strike", name: "Strike", cost: 0, types: ["spell"],
        effect: { kind: "damage", amount: 2, targets: [] }
      },
      {
        id: "judge", name: "Judge Required", cost: 0, types: ["spell"],
        effect: { kind: "judge-required", reason: "official text not modeled" }
      },
      { id: "token", name: "Token Placeholder", cost: 0, types: ["token"] },
      {
        id: "score", name: "Score", cost: 0, types: ["spell"],
        effect: {
          kind: "gain-points", amount: 3,
          targets: [{ kind: "player", playerId: "a" }]
        }
      },
      { id: "expensive", name: "Too Expensive", cost: 3, types: ["spell"] }
    ],
    rules: { targetPoints: 3, startingEnergy: 2, drawOnTurnStart: false }
  });
}

function action(projection, id) {
  const result = projection.actionOptions.actions.find(candidate =>
    candidate.id === id
  );
  assert.ok(result, `missing action ${id}`);
  return result;
}

function actionIds(projection) {
  return projection.actionOptions.actions.map(candidate => candidate.id);
}

function withActor(command, playerId) {
  return { ...command, playerId };
}

test("foundation projections expose instance-bound actions without mutating state", () => {
  const state = fixture();
  const before = structuredClone(state);
  const projection = projectGame(state, "a");

  assert.equal(isGameProjection(projection), true);
  assert.deepEqual(state, before);
  assert.deepEqual(actionIds(projection), [
    "pass",
    "play:a:unit",
    "play:a:strike",
    "play:a:judge",
    "play:a:token",
    "play:a:score",
    "concede"
  ]);
  assert.equal(action(projection, "play:a:unit").enabled, true);
  assert.equal(action(projection, "play:a:strike").enabled, true);
  assert.equal(action(projection, "play:a:judge").enabled, false);
  assert.equal(action(projection, "play:a:judge").blockedReason, "judge-required");
  assert.equal(action(projection, "play:a:token").enabled, false);
  assert.equal(action(projection, "play:a:token").blockedReason, "unsupported-card-type");
  assert.equal(projection.players[0].hand.some(card =>
    card.instanceId === "a:expensive"
  ), true);
  assert.equal(actionIds(projection).includes("play:a:expensive"), false);
});

test("dynamic damage actions expose only public legal targets and listed targets resolve", () => {
  const state = fixture();
  const projection = projectGame(state, "a");
  const strike = action(projection, "play:a:strike");

  assert.deepEqual(strike.targetPolicy, {
    minTargets: 1,
    maxTargets: 1,
    options: [{ kind: "object", objectId: "b:unit" }]
  });
  assert.equal(strike.command.targets, undefined);

  const result = submitCommand(state, withActor({
    ...strike.command,
    targets: [strike.targetPolicy.options[0]]
  }, "a"));
  assert.equal(result.error, null);
  assert.equal(state.objects["b:unit"].damage, 0);
  assert.equal(result.state.objects["b:unit"].damage, 2);
});

test("target selection remains atomic and rejects hidden, forged, and duplicate targets", () => {
  const state = fixture();
  for (const targets of [
    [{ kind: "object", objectId: "a:strike" }],
    [{ kind: "object", objectId: "missing" }],
    [{ kind: "player", playerId: "b" }],
    [{ kind: "object", objectId: "b:unit" }, { kind: "object", objectId: "b:unit" }]
  ]) {
    const result = submitCommand(state, {
      type: "play-card", playerId: "a", instanceId: "a:strike", targets
    });
    assert.equal(result.error?.code, "invalid_command");
    assert.equal(result.state, state);
    assert.deepEqual(result.events, []);
  }
});

function withLegacyPrompt(kind) {
  // Restored states may already contain prompts produced before play authorization.
  const state = fixture();
  const judge = kind === "judge-required";
  const taskId = "task:legacy";
  const optionId = judge ? "judge-required" : "target:object:b:unit";
  state.outstandingTasks.push({
    id: taskId,
    sourceCardId: judge ? "judge" : "strike",
    sourceObjectId: judge ? "a:judge" : "a:strike",
    sourcePlayerId: "a",
    reason: judge ? "judge-required" : "resolve-effect",
    optional: false,
    effect: judge
      ? { kind: "judge-required", reason: "official text not modeled" }
      : { kind: "damage", amount: 2, targets: [] },
    ...(!judge ? {
      targetChoices: [{ kind: "object", objectId: "b:unit" }],
      requiresTargetChoice: true
    } : {})
  });
  state.prompt = {
    id: `prompt:${taskId}`,
    ownerPlayerId: "a",
    playerId: "a",
    stateVersion: state.version,
    status: "pending",
    taskId,
    reason: judge ? "judge-required" : "resolve-effect",
    optional: false,
    options: [{ id: optionId, label: optionId }]
  };
  return state;
}

test("restored prompt projections authorize only the owner while preserving concession", () => {
  const prompted = withLegacyPrompt("resolve-effect");
  const owner = projectGame(prompted, "a");
  const opponent = projectGame(prompted, "b");
  assert.equal(isGameProjection(owner), true);
  assert.deepEqual(actionIds(opponent), ["concede"]);
  assert.equal(owner.actionOptions.actions[0].id, "concede");
  const answer = action(owner, `${prompted.prompt.id}:target:object:b:unit`);
  assert.equal(answer.enabled, true);
  const resolved = submitCommand(prompted, withActor(answer.command, "a"));
  assert.equal(resolved.error, null);
  assert.equal(resolved.state.objects["b:unit"].damage, 2);
  assert.equal(resolved.state.prompt, null);
});

test("restored judge-required prompts remain disabled and cannot be answered by players", () => {
  const prompted = withLegacyPrompt("judge-required");
  const projection = projectGame(prompted, "a");
  const judgeAnswer = action(projection, `${prompted.prompt.id}:judge-required`);
  assert.equal(judgeAnswer.enabled, false);
  assert.equal(judgeAnswer.blockedReason, "judge-required");
  const result = submitCommand(prompted, withActor(judgeAnswer.command, "a"));
  assert.equal(result.error?.code, "judge_required");
  assert.equal(result.state, prompted);
  assert.deepEqual(result.state, prompted);
  assert.deepEqual(result.events, []);
});

test("spectators, opponents, and ended games do not receive private or actionable state", () => {
  const state = fixture();
  const spectator = projectGame(state, null);
  const opponent = projectGame(state, "b");

  assert.deepEqual(spectator.actionOptions.actions, []);
  assert.deepEqual(opponent.actionOptions.actions, [
    { id: "concede", command: { type: "concede" },
      targetPolicy: { minTargets: 0, maxTargets: 0, options: [] }, enabled: true }
  ]);
  assert.equal(spectator.players[0].hand.length, 0);
  assert.equal(opponent.players[0].hand.length, 0);
  assert.equal(spectator.objects.some(object => object.objectId.startsWith("a:")), false);
  assert.equal(opponent.objects.some(object => object.objectId.startsWith("a:")), false);

  const score = action(projectGame(state, "a"), "play:a:score");
  const ended = submitCommand(state, withActor(score.command, "a"));
  assert.equal(ended.error, null);
  assert.equal(ended.state.phase, "ended");
  assert.deepEqual(projectGame(ended.state, "a").actionOptions.actions, []);
});

test("a dynamic card with no legal public target is disabled rather than given a fake target", () => {
  const projection = projectGame(fixture({ withTarget: false }), "a");
  const strike = action(projection, "play:a:strike");
  assert.equal(strike.enabled, false);
  assert.equal(strike.blockedReason, "no-legal-target");
  assert.deepEqual(strike.targetPolicy, {
    minTargets: 0, maxTargets: 0, options: []
  });
});
