import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/monster-harpoon.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-dcd84bc6f139a59761dc429118b1fffa13bfd4f72bd4703bd4da2d06d4e6bd3d";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 2 to a unit at a battlefield. If you control a facedown card, deal 4 to it instead.";

const [speed, play] = program.abilities;
const [dealTwo, dealFour] = play.body;
const UNIT = "monster-harpoon.unit";

test("unl-014-219 Monster Harpoon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-014-219 Monster Harpoon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Facedown/);
  assert.match(program.judgeReason, /355\.9\.a\.3/);
  assert.match(program.judgeReason, /107\.3\.e/);
  assert.match(program.judgeReason, /RIFT-84/);
});

test("unl-014-219 Monster Harpoon: [Action] plus two complementary damage branches on one locked unit", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["monster-harpoon.deal-2", "effect.damage"],
    ["monster-harpoon.deal-4", "effect.damage"]
  ]);

  // 418.1 / 355.10.b: the unit is the target; "at a battlefield" only restricts it.
  const target = {
    id: UNIT,
    filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
    min: 1,
    max: 1,
    selection: "one"
  };
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealTwo.args.target, { kind: "constant", value: UNIT });
  assert.deepEqual(dealTwo.targets, [target]);
  assert.deepEqual(dealFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(dealFour.args.target, { kind: "constant", value: UNIT });
  assert.deepEqual(dealFour.targets, [target]);
  assert.equal(dealTwo.linkedTo, undefined);
  assert.equal(dealFour.linkedTo, undefined);

  // 135.2.b.5 / contract 3.4: the clause guards only its own instruction, and the two

  // branches are complements of the same condition.
  assert.equal(dealTwo.condition.kind, "not");
  assert.deepEqual(dealTwo.condition.condition, dealFour.condition);
  assert.equal(dealFour.condition.kind, "compare");
  assert.equal(dealFour.condition.operator, "gte");
  assert.deepEqual(dealFour.condition.right, { kind: "constant", value: 1 });
  assert.deepEqual(dealFour.condition.left.filter, {
    controller: "controller",
    states: "face-down"
  });
});

test("unl-014-219 Monster Harpoon golden: the two-damage branch marks 2 on the locked unit", () => {
  const kernel = world()
    .unit("battlefield-unit", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [kernel.ref("battlefield-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 2);
  assert.equal(run.linked.dealt, 2);
});

test("unl-014-219 Monster Harpoon golden: the four-damage branch marks 4 on the same locked unit", () => {
  const kernel = world()
    .unit("battlefield-unit", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealFour.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [kernel.ref("battlefield-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 4);
  assert.equal(run.linked.dealt, 4);
});

test("unl-014-219 Monster Harpoon golden: a stale target ignores the branch instead of redirecting", () => {
  const kernel = world().unit("battlefield-unit", { might: 5 }).build();
  const stale = kernel.ref("battlefield-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo("unl-014-219 Monster Harpoon: evaluate 'if you control a facedown card' — needs the Facedown Zone representation and a controller-scoped facedown query (CR 355.9.a.3 / 107.3.a / 107.3.e; RIFT-84 Hidden/facedown, RIFT-89 facedown play)");
test.todo("unl-014-219 Monster Harpoon: the printed [Action] Showdown permission needs the continuous.timing consumer and the chain canAct wiring (CR 806 / 159.2.a) — RIFT-85 / RIFT-120 follow-up");

