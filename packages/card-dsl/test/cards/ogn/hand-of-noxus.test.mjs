import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/hand-of-noxus.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c65f6bc670e670cfb9086db63e2e7e090e36f226d4eb71005c0460c57fe89b49";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that add resources " +
  "can't be reacted to. Get the effect if you've played a card this turn.)";

const [ability] = program.abilities;
const [addEnergy] = ability.body;

test("ogn-253-298 Hand of Noxus: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-253-298 Hand of Noxus: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /812\.1\.b\.1/);
  assert.match(program.judgeReason, /RIFT-82/);
});

test("ogn-253-298 Hand of Noxus: Reaction activation with the printed Exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.c/813.1.d + 430.3: [Reaction] Add ability activation permission.
  assert.equal(ability.timing, "reaction");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("ogn-253-298 Hand of Noxus: [Legion] gate preserved as a restriction shape", () => {
  // 812.1 / 812.1.b.1 / 812.1.c: Legion gates the dependent ability on having
  // played another card this turn, excluding the Legion card itself. The gate
  // is declared as a restriction carrying the history comparison; no merged
  // consumer exists for card restrictions, and 812.1.c's exclude dimension is
  // the contract 3.8 follow-up owned by RIFT-82.
  assert.equal(ability.restriction.kind, "legion");
  assert.deepEqual(ability.restriction.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ogn-253-298 Hand of Noxus: the [Add] 1 Energy body executes", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(addEnergy.id, "hand-of-noxus.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5: "[Add] :rb_energy_1:" adds 1 Energy to the controller.
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(addEnergy.linkedTo, undefined);

  const kernel = world().player("A", { energy: 0 }).build();
  const run = runInstruction(resources, addEnergy.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
});

test("ogn-253-298 Hand of Noxus: the Exhaust cost is payable and the body runs the card's own args", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("noxus", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("noxus")) });
  const plan = buildCostPlan(ctx, { id: "hand-of-noxus", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  // The printed cost is only :rb_exhaust: (no Energy); the Add 1 Energy is the
  // effect, so payment itself must not change the pool.
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.object(ctx.ref("noxus")).exhausted, true);
  assert.equal(ctx.player("A").energy, 1);

  // effect.resources must be driven through runInstruction: the merged
  // interpreter pre-evaluates instruction args, while the resource primitive
  // re-parses them as Exprs (see the todo). The card's own declared args are
  // used unchanged.
  const run = runInstruction(resources, addEnergy.args, { world: ctx });
  assert.equal(run.result.status, "executed");
  assert.equal(ctx.player("A").energy, 2, "the [Add] 1 Energy lands after the exhaust cost");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
});

test.todo(
  "ogn-253-298: evaluate the Legion gate (812.1.b.1 / 812.1.c “another card this turn”) via a merged " +
    "condition.history / condition.predicate path with HistoryQuery.exclude (RIFT-82 / RIFT-90)"
);

test.todo(
  "ogn-253-298: honor the 430.2.a immediate finalize/resolve and 430.3 Reaction-Add payment window for " +
    "resource-adding activated abilities (RIFT-89)"
);

test.todo(
  "ogn-253-298: run the whole body through runAbilityBody — the merged interpreter evaluates args before " +
    "dispatch while effect.resources re-parses Exprs, so interpreter-driven execution of Expr-parsing " +
    "primitives (effect.resources/draw/channel) is not wired (contract follow-up for RIFT-89/90)"
);
