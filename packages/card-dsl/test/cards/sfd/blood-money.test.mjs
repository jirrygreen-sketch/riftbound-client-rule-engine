import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blood-money.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [, play] = program.abilities;
const [killInstruction, enemyToken, friendlyToken] = play.body;

/** The spell source; "source" in the branch conditions is the ability source. */
function spellWorld(owner) {
  const kernel = world()
    .player("A")
    .hand("spell", { owner: "A", types: ["spell"] })
    .unit("victim", { owner, might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const bound = kernel.clone({ sourceSnapshot: kernel.getObject("spell") });
  bound.setTargets("blood-money.unit", [bound.ref("victim")]);
  return bound;
}

test("Blood Money program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-7551ce962903e76a505471142dd69fbb43e0d921a67fd4e02d1f0cc264eaec6b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /locationType/);
  assert.match(program.judgeReason, /mightAtMost/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill a unit at a battlefield with 2 :rb_might: or less. If it was an enemy unit, play a Gold gear token exhausted. If it was a friendly unit, play two Gold gear tokens exhausted."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Blood Money structure: Action keyword, battlefield Might<=2 target, linked token branches", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["blood-money.kill", "blood-money.enemy-token", "blood-money.friendly-tokens"]
  );

  // "Kill a unit at a battlefield with 2 [M] or less": the unit is the target
  // (355.10 / 355.10.b); the location and Might cap are target restrictions
  // (355.9.b) and stay declared as filter data.
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "blood-money.unit" });
  assert.equal(killInstruction.targets.length, 1);
  const [target] = killInstruction.targets;
  assert.equal(target.id, "blood-money.unit");
  assert.equal(target.selection, "one");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.deepEqual(target.filter, {
    type: "unit",
    locationType: "battlefield",
    mightAtMost: 2
  });

  // The two token clauses are linked to the kill (359.3.e.14) and each carries
  // its own "if it was an enemy/friendly unit" condition (contract 3.4: a
  // condition applies to exactly the instruction that owns it).
  assert.equal(enemyToken.op, "effect.token");
  assert.equal(enemyToken.linkedTo, "blood-money.kill");
  assert.deepEqual(enemyToken.args, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "controller" } },
    linkKey: { kind: "constant", value: "goldToken" }
  });
  assert.equal(enemyToken.condition.operator, "ne");
  assert.deepEqual(enemyToken.condition.left, {
    kind: "object-property",
    object: { linked: "blood-money.kill" },
    property: "controller"
  });

  assert.equal(friendlyToken.op, "effect.token");
  assert.equal(friendlyToken.linkedTo, "blood-money.kill");
  assert.deepEqual(friendlyToken.args.amount, { kind: "constant", value: 2 });
  assert.equal(friendlyToken.condition.operator, "eq");
  assert.deepEqual(friendlyToken.condition.right, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
});

test("Blood Money golden: the kill half kills the locked battlefield unit", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("victim");
  const run = runInstruction(kill, { target: "blood-money.unit" }, {
    world: kernel,
    targets: { "blood-money.unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
});

test("Blood Money golden: a stale target is ignored instead of being redirected", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "blood-money.unit" }, {
    world: kernel,
    targets: { "blood-money.unit": [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Blood Money golden: the enemy branch runs after killing an enemy unit and stops at the Gold definition", () => {
  const kernel = spellWorld("B");
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["blood-money.kill", "executed", null],
      // 187.5's Gold has its own activated ability, so the frozen
      // effect.token definition table refuses it instead of creating a
      // different token; the branch condition itself is satisfied.
      ["blood-money.enemy-token", "negated", "impossible"],
      // The friendly clause's own condition is false, so it never executes.
      ["blood-money.friendly-tokens", "negated", "skipped"]
    ]
  );
  // The refused play leaves the empty receipt of the actual attempt: nothing
  // was created or played (no substitute token, no Board creation).
  assert.deepEqual(outcome.linkedValues["blood-money.enemy-token.goldToken"], {
    amount: 0,
    objects: [],
    objectsComplete: true
  });
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
});

test("Blood Money golden: the friendly branch runs after killing a friendly unit and stops at the Gold definition", () => {
  const kernel = spellWorld("A");
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["blood-money.kill", "executed", null],
      ["blood-money.enemy-token", "negated", "skipped"],
      ["blood-money.friendly-tokens", "negated", "impossible"]
    ]
  );
  // 359.3.e.13: the branch reads the controller the killed unit had before dying.
  assert.deepEqual(outcome.linkedValues["blood-money.friendly-tokens.goldTokens"], {
    amount: 0,
    objects: [],
    objectsComplete: true
  });
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
});

test.todo(
  "Blood Money token branches: the Gold gear token (CR 187.5, with its own activated " +
    "ability) is played exhausted (143.4 / 185.2.d entry override) through chain creation plus " +
    "the play handoff (440.2.c / 185.2.a); 依赖 Gold token 定义与入场状态改写（token 原语任务）"
);

test("Blood Money golden: the merged effect.token primitive itself refuses the Gold definition", () => {
  // The card's clauses name the printed "gold" definition; the merged primitive
  // reports its own refusal reason for definitions that carry abilities
  // (CR 187.5), which is the actual evidence for the judge-required token half.
  const kernel = world().player("A")
    .unit("gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const run = runInstruction(token, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    linkKey: { kind: "constant", value: "goldToken" }
  }, { world: kernel.clone({ sourceSnapshot: kernel.getObject("gear") }) });

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked.goldToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({ zone: "board", type: "gear" }).length, 1);
  // No token object exists after the refusal: the only board object is the host Gear.
  assert.deepEqual(kernel.objects.filter((object) => object.isToken).map((object) => object.ref.id), []);
});

test.todo(
  "Blood Money target legality: Finalize must restrict the kill target to units at a " +
    "battlefield with Might 2 or less (355.9.b) and exclude Pending chain items (355.9 / 3.4); " +
    "依赖目标系统的数值谓词（locationType / mightAtMost 目前只是过滤器数据）"
);
