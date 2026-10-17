import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-unity.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0e433716a00b8132f28b20fbf6ccf140068457e64d2ef62cba8d491d4396dc15";
const SOURCE_TEXT = "Kill an enemy Chaos (:rb_rune_chaos:) unit or gear.";
const TARGET_ID = "decree-of-unity.enemy-chaos-object";

const [play] = program.abilities;
const [killInstruction] = play.body;
const targetSpec = killInstruction.targets[0];

test("ven-131-166 Decree of Unity: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-131-166 Decree of Unity: judgeReason names the missing domain predicate", () => {
  // CR 134 domain of an object lives in ObjectSnapshot.power; the merged matchers do not read it.
  assert.match(program.judgeReason, /134/);
  assert.match(program.judgeReason, /power/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-131-166 Decree of Unity: one kill instruction over an enemy unit-or-gear target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(killInstruction.id, "decree-of-unity.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, { target: { kind: "constant", value: TARGET_ID } });
  // 355.7 / 355.9.a.1: one chosen Board object; "unit or gear" is a type union and
  // "Chaos" is the 134 domain restriction (declared, not yet consumed).
  assert.deepEqual(targetSpec, {
    id: TARGET_ID,
    filter: {
      type: ["unit", "gear"],
      zone: "board",
      controller: "opponent",
      power: ["Chaos"]
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(killInstruction.picks, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.condition, undefined);
  // The declared primitive really is the merged registry entry.
  assert.equal(instructionDefinitionsById.get("effect.kill"), kill);
});

test("ven-131-166 Decree of Unity golden: a locked enemy unit is killed through the merged primitive", () => {
  const kernel = world()
    .object("enemy-chaos")
    .unit("enemy-unit", { owner: "B", controller: "B", power: ["Chaos"], might: 3 })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], power: ["Chaos"] })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("enemy-unit")]);
  // The reference kernel compares filter values literally, so the enemy
  // placeholder is locked through ctx.targets() the same way the chain would.
  const body = play.body.map(({ targets, ...instruction }) => instruction);

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["decree-of-unity.kill", "executed"]
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
  // 429.2.a: the killed unit goes to the trash, the gear stays on the board.
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("ven-131-166 Decree of Unity golden: a locked enemy gear is killed the same way", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], power: ["Chaos"] })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("enemy-gear")]);
  const body = play.body.map(({ targets, ...instruction }) => instruction);

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
});

test("ven-131-166 Decree of Unity golden: a dead locked reference is ignored (359.3.e.6-e.8)", () => {
  const kernel = world().unit("gone", { owner: "B", controller: "B", might: 3 }).build();
  const stale = kernel.ref("gone");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(TARGET_ID, [stale]);
  const body = play.body.map(({ targets, ...instruction }) => instruction);

  const outcome = resolveChainBody(body, kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.result), [
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("gone").zone, "hand");
});

test("ven-131-166 Decree of Unity: direct primitive evidence for the kill half", () => {
  const kernel = world().unit("victim", { owner: "B", controller: "B", might: 2 }).build();
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("victim")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("victim").zone, "trash");
});

test.todo(
  "ven-131-166 Decree of Unity: the target filter must evaluate the Chaos domain (134, " +
    "ObjectSnapshot.power) so only Chaos units/gear are legal — needs the domain predicate in the " +
    "target predicate vocabulary (RIFT-359); until then the declared power: [\"Chaos\"] has no consumer"
);
