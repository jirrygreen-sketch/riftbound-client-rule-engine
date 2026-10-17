// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Irelia, Graceful, and the merged cost-plan vocabulary it would have to reach.
// The whole-card execution evidence (its own scenario through the generic card
// harness plus the measured outcome of binding its own static ability with the
// production binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: continuous.cost-modification has no layer
// mapping, no pipeline compiles the declaration into CostPlanInput.discounts, and
// neither the per-target condition nor the Universal Power alternative is
// representable. Nothing here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/irelia-graceful.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03";
const SOURCE_TEXT = "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less.";
const [ability] = program.abilities;

test("sfd-141-221 Irelia, Graceful: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-141-221 Irelia, Graceful: one static cost reduction scoped to spells that choose this unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 363: the printed "While …"-free passive cost change is a Passive Ability.
  assert.equal(ability.effect.kind, "continuous.cost-modification");
  assert.equal(ability.effect.stage, "discount");
  // 356.4.b / 356.4.c: a per-component "cost [amount] less".
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  // 163.2.b: the printed "or [A]" alternative stays an explicit Universal Power.
  assert.deepEqual(ability.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 355.6: "choose" means Targeting, and "me" is the symbolic self selector.
  assert.deepEqual(ability.effect.appliesTo, { type: "spell", object: "self" });
  assert.equal(ability.condition, undefined);
});

test("sfd-141-221 Irelia, Graceful: the production binder refuses the declared discount twice", () => {
  // 355.6 / 356.4.c: the merged binder refuses the authored appliesTo shape, and
  // with the "self" shorthand it still has no layer for the kind, so the discount
  // can never reach CostPlanInput.discounts.
  const kernel = world()
    .unit("irelia", { cardId: CARD_ID, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("irelia");
  const layers = createLayerEngine([source]);
  const binder = createEngineStaticBinder({ layers });
  assert.throws(
    () => binder.bindStatic(ability, source),
    /Unsupported static appliesTo \{"type":"spell","object":"self"\}/
  );
  assert.throws(
    () => binder.bindStatic({ ...ability, effect: { ...ability.effect, appliesTo: "self" } }, source),
    /Static ability kind continuous\.cost-modification has no layer mapping/
  );
  assert.deepEqual(layers.registry.list(), []);
});

test("sfd-141-221 Irelia, Graceful: judgeReason names the measured consumer gaps", () => {
  // Re-probed 2026-10-17 (RIFT-667).
  assert.match(program.judgeReason, /staticTarget/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /CostPlanInput\/CostDiscount/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test.todo(
  "sfd-141-221 Irelia, Graceful: a spell that chooses me must really cost 1 Energy or 1 Universal Power less " +
    "(CR 355.6 / 356.4.b / 163.2.b) - needs a CardProgram -> Finalize discount consumer with a per-target " +
    "condition and a representable [A] alternative (contract change request)"
);
