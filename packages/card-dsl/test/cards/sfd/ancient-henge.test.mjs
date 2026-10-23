import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/ancient-henge.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { describeActivate } from "../../../../engine-core/dist/programs/activate.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CARD_ID = "card.hash-d07e48aa4c135d7523968d576a0ed10afd4b5574804fc3baa31b2d60b20f46a3";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — Pay any amount of Energy to [Add] that much :rb_rune_rainbow:. " +
  "(Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;

test("sfd-117-221 Ancient Henge: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-117-221 Ancient Henge: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /204\.3/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /430\.2/);
  assert.match(program.judgeReason, /cost\.pay-any/);
  assert.match(program.judgeReason, /programs\/activate\.ts/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-117-221 Ancient Henge: Reaction activated ability with the printed Exhaust cost and the pay-any/Add body", () => {
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(ability.kind, "activated");
  // 813.1.c.2/813.1.d: [Reaction] on an ability is the Closed-State activation
  // permission, declared directly on the activated ability.
  assert.equal(ability.timing, "reaction");
  // 404.1.a/415.5: :rb_exhaust: before the dash is "Exhaust this".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });

  assert.equal(ability.body.length, 2);
  const [payAny, addThatMuch] = ability.body;
  // 204.3/204.3.a: the resolve-time "pay any amount" cost, whose paid amount
  // feeds the Add below.
  assert.equal(payAny.id, "ancient-henge.pay-any-energy");
  assert.equal(payAny.op, "cost.pay-any");
  assert.equal(payAny.linkedTo, undefined);
  assert.equal(payAny.targets, undefined);
  assert.equal(payAny.picks, undefined);
  // "[Add] that much [A]": a repeat reading the paid amount, each iteration
  // adding one Universal Power (135.2.e.5/163.2.b).
  assert.equal(addThatMuch.id, "ancient-henge.add-that-much");
  assert.equal(addThatMuch.op, "repeat");
  assert.equal(addThatMuch.linkedTo, payAny.id);
  assert.deepEqual(addThatMuch.args.count, {
    kind: "linked-value",
    instructionId: payAny.id,
    key: "paid"
  });
  const [addOne] = addThatMuch.args.body.value;
  assert.equal(addOne.id, "ancient-henge.add-one-universal-power");
  assert.equal(addOne.op, "effect.resources");
  assert.deepEqual(addOne.args.power, { kind: "constant", value: ["rainbow"] });
  assert.equal(addOne.args.energy, undefined);
});

test("sfd-117-221 Ancient Henge: the printed Exhaust cost is payable under the merged cost pipeline", () => {
  const kernel = world()
    .unit("ancient-henge", {
      types: ["gear"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ancient-henge") });
  const plan = buildCostPlan(context, { id: "ancient-henge", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.equal(context.object(context.ref("ancient-henge")).exhausted, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust"]);
});

test.todo(
  "Ancient Henge: choose and pay an arbitrary amount at Resolve with a success-gated Add body and actual paid amount link (204.3/204.3.a)"
);
test.todo(
  "Ancient Henge: represent domainless Universal Power without substituting a colored source (135.2.e.5/163.2.b)"
);
test.todo(
  "Ancient Henge: classify the activated program as an add ChainKind so 430.2/430.3 resolve immediately without reactions"
);

test("sfd-117-221 Ancient Henge: the resolve-time pay-any primitive is registered while this card's array shape stays unpayable", () => {
  // 204.3/204.3.a: "Pay any amount of Energy" is chosen at resolution. The
  // merged payer only accepts an already finalized plan, so the authored
  // resolve-time cost descriptor cannot be paid as written, and there is no
  // cost.pay-any primitive in the registry.
  const kernel = world().player("A", { energy: 3 }).build();
  assert.equal(instructionDefinitionsById.has("cost.pay-any"), true);
  assert.throws(() => runInstruction(costPay, {
    payments: { kind: "constant", value: [{ kind: "amount", object: "self" }] }
  }, { world: kernel }), error => error.reason === "cannot-pay-cost");
  assert.equal(kernel.player("A").energy, 3);
});

test("sfd-117-221 Ancient Henge: Universal Power is not a closed Domain and stays impossible", () => {
  // 135.2.e.5/163.2.b: [A] is Universal Power. The merged resource primitive
  // accepts only the six closed Domains, so a rainbow request is impossible
  // rather than being approximated by a colored domain.
  const kernel = world().player("A").build();
  const run = runInstruction(resources, {
    power: { kind: "constant", value: ["rainbow"] }
  }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(kernel.player("A").power, []);
});

test("sfd-117-221 Ancient Henge: the activation draft is not an add chain item", () => {
  // 430.2/430.2.a: an Add ability resolves immediately and cannot be reacted to.
  // The merged activation binding emits kind "activated" for this ability, so
  // nothing treats it as an add item.
  const kernel = world().unit("ancient-henge", {
    cardId: CARD_ID, types: ["gear"], might: null, zone: "board", location: { type: "base", player: "A" }
  }).build();
  const { judgeReason, ...executable } = program;
  const registry = new ProgramRegistry([{ ...executable, status: "executable" }]);
  const draft = describeActivate(registry, kernel.getObject("ancient-henge"), "A", 0);
  // chain/engine.ts books an activated draft as kind "activated"; nothing
  // reclassifies it as the add kind that 430.2 requires.
  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "reaction");
});


test("Ancient Henge: the merged payer reports an explicit Energy payment and aborts without enough Energy", () => {
  const kernel = world().player("A", { energy: 3 }).build();
  const run = runInstruction(costPay, { payments: { kind: "constant", value: { energy: 2 } } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.payment.paid, true);
  assert.equal(run.linked.payment.total.energy, 2);
  assert.equal(kernel.player("A").energy, 1);
  const before = kernel.snapshot();
  assert.throws(() => runInstruction(costPay, { payments: { kind: "constant", value: { energy: 2 } } }, { world: kernel }),
    error => error.reason === "cannot-pay-cost");
  assert.deepEqual(kernel.snapshot(), before);
});
