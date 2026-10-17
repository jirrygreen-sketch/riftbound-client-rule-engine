import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ezreal-prodigy.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-88ad91a69950ae1cab7ff15331a758eeeb0d0042e84133e1a35faee954d7807d";
const SOURCE_TEXT =
  "When you play me, discard 1, then draw 2.\n" +
  "Optional additional costs you pay cost :rb_energy_1: or :rb_rune_rainbow: less.";

const [triggered, costStatic] = program.abilities;
const [discardOne, drawTwo] = triggered.body;

test("sfd-149-221 Ezreal, Prodigy: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-149-221 Ezreal, Prodigy: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /CostPlanInput.discounts/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-149-221 Ezreal, Prodigy: card-played self trigger with discard 1 then draw 2", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(triggered.kind, "triggered");
  // 420.4.a: "When you play me" fires once the play action completes.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);

  assert.deepEqual(triggered.body.map((entry) => [entry.id, entry.op]), [
    ["ezreal-prodigy.discard-1", "effect.discard"],
    ["ezreal-prodigy.draw-2", "effect.draw"]
  ]);
  // 423.1 / 423.1.a: an effect discard for the controller (190.6.d), chosen as a
  // non-target Hand pick (355.10.a).
  assert.deepEqual(discardOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(discardOne.targets, undefined);
  assert.equal(discardOne.picks, undefined);
  assert.equal(discardOne.linkedTo, undefined);
  // "then draw 2": 414.1 / 414.3, an independent instruction (055: a negated
  // discard does not suppress a successor that does not reference it).
  assert.deepEqual(drawTwo.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(drawTwo.linkedTo, undefined);
});

test("sfd-149-221 Ezreal, Prodigy: the optional-additional-cost discount is scoped to that cost component", () => {
  assert.equal(costStatic.kind, "static");
  // 356.2.b / 356.4 / 356.4.c / 356.4.f: the reduction applies only to the
  // optional additional cost the player chose to pay. 356.4.f.1 makes the
  // payment DECISION the receipt, not the amount actually paid.
  assert.equal(costStatic.effect.kind, "continuous.cost-modification");
  assert.equal(costStatic.effect.stage, "discount");
  assert.equal(costStatic.effect.component, "optional-additional");
  assert.equal(costStatic.effect.resource, "energy");
  assert.deepEqual(costStatic.effect.amount, { kind: "constant", value: 1 });
  // "or [A]": 163.2.b Universal Power kept as its own alternative.
  assert.deepEqual(costStatic.effect.alternative, { resource: "power", universal: true, amount: 1 });
  assert.equal(costStatic.effect.appliesTo, "optional-additional-costs-you-pay");
  assert.equal(costStatic.condition, undefined);
});

test("sfd-149-221 Ezreal, Prodigy golden: the body discards one chosen card and then draws two", () => {
  const kernel = world()
    .hand("kept", { owner: "A" })
    .hand("discarded", { owner: "A" })
    .deck(["top", "second"], { owner: "A" })
    .build();
  // 423.1.a: the discarding player chooses privately; the reference kernel
  // replays that choice by the interpreter's path-qualified request id.
  kernel.setAnswers({ "ezreal-prodigy.discard-1/effect.discard%3AA": [kernel.ref("discarded")] });

  const outcome = resolveChainBody(triggered.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["discarded"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), []);
  // The two drawn cards join the kept hand card; 414.1.a takes them from the top.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["kept", "top", "second"]);
  // One game action per instruction: the draw action carries amount 2.
  assert.deepEqual(outcome.events.map((event) => event.action), ["discard", "draw"]);
  // The interpreter qualifies each link with the instruction path.
  assert.equal(outcome.linkedValues["ezreal-prodigy.discard-1.discarded"].count, 1);
  assert.equal(outcome.linkedValues["ezreal-prodigy.draw-2.drawn"], 2);
});

test("sfd-149-221 Ezreal, Prodigy golden: the draw still happens when the discard has nothing to discard (055)", () => {
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const outcome = resolveChainBody(triggered.body, kernel);

  // 423.4: the discard is negated as impossible (an effect discards as much as
  // possible); the independent draw still resolves.
  assert.equal(outcome.status, "partial");
  const [discardResult, drawResult] = outcome.results;
  assert.equal(discardResult.result.status, "negated");
  assert.equal(discardResult.result.reason, "impossible");
  assert.equal(drawResult.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top", "second"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("sfd-149-221 Ezreal, Prodigy golden: the discard primitive alone moves the chosen hand card to Trash", () => {
  const kernel = world().hand("kept", { owner: "A" }).hand("discarded", { owner: "A" }).build();
  const run = runInstruction(
    discard,
    discardOne.args,
    { world: kernel, answers: { "effect.discard:A": [kernel.ref("discarded")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.count, 1);
  assert.deepEqual(run.linked.discarded.objects, [{ id: "discarded", zoneEntryId: 1 }]);
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["discarded"]);
});


// The component ID is still supplied by the caller: these goldens verify the
// merged cost layer, not automatic discovery of this card's static discount.
for (const resource of ["energy", "power"]) {
  test(`sfd-149-221 Ezreal, Prodigy cost golden: the ${resource} alternative discounts only the selected component`, () => {
    const base = world().unit("spell", { energy: 3, power: null }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
    const cost = resource === "energy"
      ? { energy: { kind: "constant", value: 2 } }
      : { payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["Chaos"] }] };
    const modifier = resource === "energy"
      ? { resource: costStatic.effect.resource, amount: costStatic.effect.amount }
      : { resource: costStatic.effect.alternative.resource, amount: { kind: "constant", value: costStatic.effect.alternative.amount } };
    const run = runInstruction(costModify, {
      id: `ezreal-${resource}-discount`,
      cost: { kind: "printed" },
      optionalAdditional: [{ id: "repeat", kind: "repeat", selected: true, cost }],
      modifier: { kind: "reduce", ...modifier, component: "repeat" }
    }, { world: kernel });

    assert.equal(run.result.status, "executed");
    const plan = run.linked.cost;
    assert.equal(plan.base.energy, 3);
    assert.equal(plan.printed.power, null);
    assert.deepEqual(plan.selectedAdditional, [{ id: "repeat", kind: "repeat" }]);
    const component = plan.components.find(entry => entry.id === "repeat");
    assert.equal(component.stage, "optional-additional");
    if (resource === "energy") {
      assert.equal(component.original.energy, 2);
      assert.equal(component.cost.energy, 1);
      assert.equal(plan.total.energy, 4);
    } else {
      assert.deepEqual(component.original.power, [{ amount: 2, allowedDomains: ["Chaos"] }]);
      assert.deepEqual(component.cost.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);
      assert.equal(plan.total.energy, 3);
    }
    assert.equal(plan.discounts[0].component, "repeat");
    assert.equal(plan.discounts[0].before, 2);
    assert.equal(plan.discounts[0].after, 1);
    assert.deepEqual(kernel.events, []);
  });
}

test("sfd-149-221 Ezreal, Prodigy cost golden: a selected additional cost reduced to zero remains paid (356.4.f.1)", () => {
  const base = world().player("A", { energy: 3 }).unit("spell", { energy: 3, power: null }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
  const modified = runInstruction(costModify, {
    id: "ezreal-zero-repeat",
    cost: { kind: "printed" },
    optionalAdditional: [{ id: "repeat", kind: "repeat", selected: true, cost: { energy: { kind: "constant", value: 1 } } }],
    modifier: { kind: "reduce", resource: costStatic.effect.resource, amount: costStatic.effect.amount, component: "repeat" }
  }, { world: kernel });
  assert.equal(modified.result.status, "executed");
  assert.equal(modified.linked.cost.components.find(entry => entry.id === "repeat").cost.energy, 0);
  const paid = runInstruction(costPay, { cost: { kind: "constant", value: modified.linked.cost } }, { world: kernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(paid.linked.payment.additional, [{ id: "repeat", kind: "repeat", paid: true }]);
  assert.deepEqual(paid.events.map(event => event.action), ["pay"]);
});

test("sfd-149-221 Ezreal, Prodigy: the merged static binder rejects optional-additional cost modification", () => {
  const source = world()
    .unit("ezreal", {
      cardId: program.canonicalCardId,
      zone: "board",
      energy: 3,
      power: ["Chaos"],
      might: 3
    })
    .build()
    .getObject("ezreal");
  const binder = createEngineStaticBinder({ layers: createLayerEngine([source]) });
  assert.throws(
    () => binder.bindStatic(costStatic, source),
    error => error.code === "judge-required" &&
      /Unsupported static appliesTo "optional-additional-costs-you-pay"/.test(error.message)
  );
});

test.todo(
  "sfd-149-221 Ezreal, Prodigy: bind continuous.cost-modification's optional-additional scope to " +
    "Finalize and discover component IDs/offer the Energy or Power choice (356.4.c/356.4.f.1)"
);
