import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-rage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-04c50ac19d094543330b995ad389879feae4cb9a688c51fa00317e7c72c11ae0";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "This can't be countered.\n" +
  "Deal 4 to an enemy Calm (:rb_rune_calm:) unit.";

const [actionKeyword, restriction, play] = program.abilities;
const [dealInstruction] = play.body;
const [unitSpec] = dealInstruction.targets;

test("ven-015-166 Decree of Rage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-015-166 Decree of Rage: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /054/);
  assert.match(program.judgeReason, /426/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /domain/);
});

test("ven-015-166 Decree of Rage: [Action], the uncounterable static restriction and one 4-damage instruction", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });

  // "This can't be countered" (426.2 + 054.1) is a static prohibition, not a
  // trigger, a replacement or a resolving instruction.
  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  assert.equal(restriction.effect.restriction, "cannot-be-countered");
  assert.equal(restriction.effect.appliesTo, "self");
  assert.equal(restriction.condition, undefined);

  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(dealInstruction.id, "decree-of-rage.deal-4");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 4 });
  assert.equal(dealInstruction.linkedTo, undefined);
  assert.equal(dealInstruction.picks, undefined);
  assert.deepEqual(unitSpec, {
    id: "decree-of-rage.enemy-calm-unit",
    filter: {
      type: "unit",
      zone: "board",
      controller: "opponent",
      characteristics: { domains: ["Calm"] }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-015-166 Decree of Rage golden: the merged primitive deals exactly 4 to the locked unit", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 7 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 4);
  assert.equal(kernel.getObject("enemy").damage, 4);
});

test("ven-015-166 Decree of Rage boundary: enough damage is lethal and follows the kernel cleanup", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 4 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  // The primitive only marks damage (418.1.c); the lethal cleanup belongs to the
  // kernel's 143.2.b / 323.4 path, which the reference kernel does not model.
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.equal(kernel.getObject("enemy").might, 4);
});

test.todo(
  "ven-015-166 Decree of Rage: enforce 'This can't be countered' (426.2 + 054.1) — the chain Counter path " +
    "(chain/engine.ts action handler and effect.counter) never reads a 'cannot be countered' declaration and " +
    "there is no registered continuous.restrict primitive"
);

test.todo(
  "ven-015-166 Decree of Rage: restrict the target to a Calm unit (CR 134) — the merged filter vocabulary " +
    "has no domain predicate, and ObjectSnapshot.power is the Power-cost domain list (contract 3.6), not the " +
    "card's domain (it would miss all 52 Calm units with power null)"
);
