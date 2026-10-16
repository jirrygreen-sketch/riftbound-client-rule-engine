import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/consuming-curse.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-eccd412b01dd63e0ce45a6b2789921b93b875f0321bcb6cea756edf8d23c9a71";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash.";

const [actionKeyword, play] = program.abilities;
const [dealInstruction] = play.body;
const [unitSpec] = dealInstruction.targets;

test("ven-010-166 Consuming Curse: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-010-166 Consuming Curse: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // The reason must name the name-based count predicate, the missing grant
  // consumer and the rules they come from (README section 2).
  assert.match(program.judgeReason, /132/);
  assert.match(program.judgeReason, /name/);
  assert.match(program.judgeReason, /713|Bonus Damage/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ven-010-166 Consuming Curse: [Action] keyword, energy-only cost and one 2-damage instruction", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);
  assert.equal(dealInstruction.id, "consuming-curse.deal-2");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 2 });
  // No bonus argument is authored: the printed Bonus Damage grant has no consumer
  // (see judgeReason); a static bonus would be a near-implementation.
  assert.equal(Object.hasOwn(dealInstruction.args, "bonus"), false);
  assert.deepEqual(unitSpec, {
    id: "consuming-curse.battlefield-unit",
    filter: { type: "unit", location: "battlefield", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-010-166 Consuming Curse golden: the base deal marks 2 damage", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 5 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: unitSpec.id },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 2);
  assert.equal(kernel.getObject("enemy").damage, 2);
});

test("ven-010-166 Consuming Curse golden: the merged primitive adds the granted Bonus Damage per target (714/715.1)", () => {
  // effect.damage consumes args.bonus (CR 714 sums the instances, 715.1 adds them
  // to the single target). The card does not author that grant (it has no
  // consumer); this pins the arithmetic the future grant must feed.
  const kernel = world().unit("enemy", { owner: "B", might: 8 }).build();
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    {
      amount: dealInstruction.args.amount,
      bonus: { kind: "constant", value: 3 },
      target: unitSpec.id
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 5);
  assert.equal(kernel.getObject("enemy").damage, 5);
});

test("ven-010-166 Consuming Curse boundary: a replaced deal grants no Bonus Damage (715.4)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 8 }).build();
  kernel.addReplacement(() => "replaced");
  const locked = kernel.ref("enemy");

  const run = runInstruction(
    damage,
    {
      amount: dealInstruction.args.amount,
      bonus: { kind: "constant", value: 3 },
      target: unitSpec.id
    },
    { world: kernel, targets: { [unitSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test.todo(
  "ven-010-166 Consuming Curse: count the controller's trash by the CR 132 card name (132.3: different " +
    "printings/languages share the name) and feed 1 Bonus Damage per such card into this Deal action — the " +
    "merged filter vocabulary has no name predicate and no Bonus Damage grant consumer (RIFT-91)"
);
