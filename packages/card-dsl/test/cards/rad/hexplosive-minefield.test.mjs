import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hexplosive-minefield.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { AwaitChoice, runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { queryLocationCandidates } from "../../../../engine-core/dist/target/location/candidates.js";

const [speed, play] = program.abilities;
const [killInstruction, delayedPlay] = play.body;
const [chooseBattlefield, playBombs] = delayedPlay.args.body.value;
const targetId = killInstruction.targets[0].id;

/**
 * The chain Finalize wrapper resolves the contract's "self" controller
 * placeholder and asks layers/filter.ts (chain/engine.ts). Bind the same
 * production query so the card's own filter really matches.
 */
function productionQuery(kernel, controller = kernel.controller) {
  return (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === controller) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      return matchesObjectFilter(resolved, object);
    });
  };
}

const bombKernel = () =>
  world()
    .player("A")
    .unit("bomb-1", { types: ["gear"], tags: ["Bomb"], isToken: true, owner: "A", controller: "A" })
    .unit("bomb-2", { types: ["gear"], tags: ["Bomb"], isToken: true, owner: "A", controller: "A" })
    .unit("plain-gear", { types: ["gear"], owner: "A", controller: "A" })
    .unit("enemy-bomb", { owner: "B", controller: "B", types: ["gear"], tags: ["Bomb"], isToken: true })
    .build();

test("rad-142-167 Hexplosive Minefield: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill any number of friendly Bomb tokens. At end of turn, play that many Bomb tokens to a single battlefield."
  );
});

test("rad-142-167 Hexplosive Minefield: judgeReason names the delayed op, full location candidates and the Bomb definition gaps", () => {
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /390/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /LocationState/);
  // Second-sweep refresh: add the two newly-verified mechanics (no numeric
  // killed count; the registered-op absence behind registerDelayedTrigger).
  assert.match(program.judgeReason, /registerDelayedTrigger|instructionDefinitionsById/);
  assert.match(program.judgeReason, /amount/);
});

test("rad-142-167 Hexplosive Minefield: the card-facing delayed-ability op is registered", () => {
  // CR 390 / 391.2 / 393: the delayed ability is created by the resolving card
  // through its registered instruction rather than by a card-owned trigger.
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), true);
  assert.equal(instructionDefinitionsById.has("trigger.leave"), true);
  assert.equal(delayedPlay.op, "trigger.delayed");
});

test("rad-142-167 Hexplosive Minefield gap: effect.kill exposes no numeric count for `that many`", () => {
  const kernel = bombKernel();
  const run = runInstruction(kill, { target: targetId }, {
    world: kernel,
    targets: { [targetId]: [kernel.ref("bomb-1"), kernel.ref("bomb-2")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed.map((ref) => ref.id).sort(), ["bomb-1", "bomb-2"]);
  // The linked value is the object list itself; there is no `count` key, so the
  // delayed body cannot feed effect.token an amount. A linked object list is
  // not accepted as an amount at all.
  assert.equal(run.linked.killed.count, undefined);
  const marker = world().unit("field-marker", { location: { type: "base", player: "A" } }).build();
  const denied = runInstruction(token, {
    token: { kind: "constant", value: "recruit" },
    mode: { kind: "constant", value: "create" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    amount: { kind: "linked-value", instructionId: "hexplosive-minefield.kill-bombs", key: "killed" },
    linkKey: { kind: "constant", value: "bombTokens" }
  }, { world: marker });
  assert.equal(denied.result.status, "negated");
  assert.equal(denied.result.reason, "impossible");
  assert.equal(marker.objects.filter((object) => object.isToken).length, 0);
});

test("rad-142-167 Hexplosive Minefield gap: the bomb definition is absent, and unrepresented battlefields need external state", () => {
  // CR 187.12's Bomb gear token is not in the merged token definition table.
  const kernel = world().unit("marker", { location: { type: "battlefield", id: "bf-1" } }).build();
  const played = runInstruction(token, {
    token: { kind: "constant", value: "bomb" },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "battlefield", id: "bf-1" } },
    linkKey: { kind: "constant", value: "bombTokens" }
  }, { world: kernel });
  assert.equal(played.result.status, "negated");
  assert.equal(played.result.reason, "impossible");
  assert.equal(played.linked.bombTokens.blockedReason, "token-definition-or-abilities-judge-required");

  // 355.10.b: the battlefield choice is expressible, but its candidate query
  // derives locations from current objects only; an empty battlefield appears
  // only when the caller supplies it as external LocationState.
  assert.deepEqual(queryLocationCandidates(kernel, { type: "battlefield" }), [{ type: "battlefield", id: "bf-1" }]);
  assert.deepEqual(
    queryLocationCandidates(kernel, { type: "battlefield" }, { locations: [{ ref: { type: "battlefield", id: "bf-empty" } }] }),
    [{ type: "battlefield", id: "bf-empty" }, { type: "battlefield", id: "bf-1" }]
  );
});


test("rad-142-167 Hexplosive Minefield: structure — Action keyword, any-number kill, delayed token play", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "hexplosive-minefield.kill-bombs",
    "hexplosive-minefield.delayed-play"
  ]);

  // "Kill any number of friendly Bomb tokens": one target spec, up-to, zero
  // allowed (355.13), Bomb gear tokens controlled by the ability controller.
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: targetId });
  assert.deepEqual(killInstruction.targets, [
    {
      id: targetId,
      filter: { type: "gear", tags: ["Bomb"], controller: "self" },
      min: 0,
      max: null,
      selection: "up-to"
    }
  ]);

  // "At end of turn, play that many Bomb tokens to a single battlefield." — a
  // delayed ability created by this spell (390 / 391.2): window this turn
  // (317.2.c), resolution at turn-end, count = what the kill instruction killed.
  assert.equal(delayedPlay.op, "trigger.delayed");
  assert.equal(delayedPlay.linkedTo, "hexplosive-minefield.kill-bombs");
  assert.deepEqual(delayedPlay.args.at, { kind: "constant", value: "turn-end" });
  assert.deepEqual(delayedPlay.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(delayedPlay.args.count, {
    kind: "linked-value",
    instructionId: "hexplosive-minefield.kill-bombs",
    key: "killed"
  });
  assert.equal(delayedPlay.args.body.kind, "constant");
  assert.equal(delayedPlay.args.body.value.length, 2);
  assert.equal(chooseBattlefield.op, "condition.value");
  assert.deepEqual(chooseBattlefield.args.value, {
    kind: "location",
    value: { kind: "choose", id: "hexplosive-minefield.battlefield", filter: { type: "battlefield" } }
  });
  assert.equal(playBombs.id, "hexplosive-minefield.play-bombs");
  assert.equal(playBombs.op, "effect.token");
  assert.deepEqual(playBombs.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(playBombs.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBombs.args.location, {
    kind: "linked-value", instructionId: chooseBattlefield.id, key: "value"
  });
  assert.deepEqual(playBombs.args.amount, {
    kind: "linked-value", instructionId: delayedPlay.id, key: "count"
  });
  assert.equal(chooseBattlefield.targets, undefined);
  assert.equal(playBombs.targets, undefined);
});

test("rad-142-167 Hexplosive Minefield supported delayed body: one public non-target choice binds the shared battlefield", () => {
  const field = { type: "battlefield", id: "later-field" };
  const other = { type: "battlefield", id: "other-field" };
  const kernel = world().unit("field-marker", { location: field })
    .unit("other-marker", { location: other }).base("base-unit").build();
  const before = kernel.snapshot();
  const choiceKey = `${chooseBattlefield.id}/hexplosive-minefield.battlefield`;
  // Only the original supported location instruction runs here. Delayed
  // registration and its captured killed count are still pending dependencies.
  assert.throws(() => resolveChainBody([chooseBattlefield], kernel), error => {
    assert.ok(error instanceof AwaitChoice);
    assert.deepEqual(error.request, {
      id: choiceKey, type: "mode", chooser: "A", visibility: "public", options: [field, other]
    });
    return true;
  });
  assert.deepEqual(kernel.snapshot(), before);
  kernel.setAnswers({ [choiceKey]: other });
  const outcome = resolveChainBody([chooseBattlefield], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues[`${chooseBattlefield.id}.value`], other);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.snapshot(), before);
});

test("rad-142-167 Hexplosive Minefield: 'Kill any number of friendly Bomb tokens' kills the chosen Bomb tokens", () => {
  const kernel = bombKernel();
  const run = runInstruction(kill, { target: targetId }, {
    world: kernel,
    targets: { [targetId]: [kernel.ref("bomb-1"), kernel.ref("bomb-2")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["kill", "kill"]);
  assert.equal(kernel.getObject("bomb-1").zone, "trash");
  assert.equal(kernel.getObject("bomb-2").zone, "trash");
  // Only Bomb tokens controlled by the ability controller are affected.
  assert.equal(kernel.getObject("plain-gear").zone, "board");
  assert.equal(kernel.getObject("enemy-bomb").zone, "board");
  assert.deepEqual(
    run.linked.killed.map(ref => ref.id).sort(),
    ["bomb-1", "bomb-2"]
  );
});

test("rad-142-167 Hexplosive Minefield golden: the card's own kill instruction runs through the chain adapter", () => {
  // The card's own body, with only the Finalize-locked target binding supplied:
  // the merged production adapter executes the real effect.kill instruction and
  // the "controller: self" filter resolves through the chain's query wrapper.
  const kernel = bombKernel().clone({ sourceSnapshot: bombKernel().getObject("plain-gear") });
  kernel.setTargets(targetId, [kernel.ref("bomb-1"), kernel.ref("bomb-2")]);
  const context = bindResolveContext(kernel, { query: productionQuery(kernel, "A") });

  const outcome = resolveChainBody([killInstruction], context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["hexplosive-minefield.kill-bombs", "executed"]
  ]);
  assert.equal(kernel.getObject("bomb-1").zone, "trash");
  assert.equal(kernel.getObject("bomb-2").zone, "trash");
  assert.equal(kernel.getObject("enemy-bomb").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "kill"]);
});

test("rad-142-167 Hexplosive Minefield: choosing zero Bomb tokens is legal and kills nothing (355.13)", () => {
  const kernel = bombKernel();
  const run = runInstruction(kill, { target: targetId }, {
    world: kernel,
    targets: { [targetId]: [] }
  });
  // CR 355.13: an "any number" choice may be zero, and the spell is playable
  // with no targets. The reference kernel reports the empty selection as
  // ignored because no still-legal target remains, but nothing was killed.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("bomb-1").zone, "board");
  assert.deepEqual(run.events, []);
});

test.todo(
  "rad-142-167 Hexplosive Minefield: 'At end of turn, play that many Bomb tokens' needs the card-facing " +
    "delayed-ability binding (CR 390 / 391.2 / 393): a registered trigger.delayed op that registers a turn-end " +
    "trigger with the killed count; a card-owned triggered ability would be wrong under 393"
);
test.todo(
  "rad-142-167 Hexplosive Minefield: playing NEW Bomb tokens to a single battlefield needs a " +
    "complete battlefield candidate list at resolution (CR 355.10.b) — the LocationExpr path only derives " +
    "locations from current objects and needs external LocationState for empty battlefields — plus a numeric " +
    "killed count from effect.kill, and the Bomb gear token definition with its Deploy + Deathknell abilities " +
    "(CR 187.12); the location expression itself is merged"
);
