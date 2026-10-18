// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/guardian-angel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-af3547abb5e6d69c2372b62331d6039acaf16cca337eefb27e5734bbee3fb307";
const SOURCE_TEXT =
  "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The Gear as it sits on the Board; printed energy/power/might stay untouched. */
function equipWorld() {
  const base = world()
    .object("gear", {
      name: "Guardian Angel",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 2,
      power: null,
      might: 1
    })
    .unit("ally", { might: 2 })
    .unit("enemy-unit", { owner: "B" })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("gear") });
}

function expansionFor() {
  const definition = keywordDefinitionsById.get("Equip");
  return definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
}

test("sfd-051-221 Guardian Angel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-051-221 Guardian Angel: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason names the missing payment path and the real dependencies.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /describeActivate 能给出草稿/);
  // The stale task attributions are replaced by the live code paths that still
  // reject the printed Equip cost.
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-261|未合入 HEAD/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes this exact program object.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-051-221 Guardian Angel: one valued Calm Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Calm");
});

test("sfd-051-221 Guardian Angel: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2: functionally "[Cost]: Attach this gear to a unit you control."
  const expansion = expansionFor();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target, limited to units you control.
  assert.deepEqual(ability.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("sfd-051-221 Guardian Angel golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  const run = runInstruction(
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
  // 150.2/150.4: the printed Equipment characteristics are never coerced.
  assert.equal(kernel.getObject("gear").energy, 2);
  assert.equal(kernel.getObject("gear").power, null);
  assert.equal(kernel.getObject("gear").might, 1);
});

test("sfd-051-221 Guardian Angel golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");

  const run = runInstruction(
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("gear").attachedTo, null);
});

test("sfd-051-221 Guardian Angel golden: the merged Equip activation cost cannot be paid (real evidence for judge-required)", () => {
  const kernel = equipWorld();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gear") });
  const [expansion] = expansionFor();

  // Guard against substituting a no-op/fake cost: the unmerged payment kind fails loudly.
  assert.throws(
    () => buildCostPlan(context, { id: "guardian-angel:equip", cost: expansion.cost }),
    (error) =>
      error instanceof CostPlanError &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
});

test("sfd-051-221 Guardian Angel boundary: the card-program binding cannot describe the activation either", () => {
  // The same rejection surface the production activate path uses: the registry
  // gate and the ability listing pass on an executable clone, the draft is
  // described, and then the Equip payment placeholder blocks its cost plan.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = equipWorld();
  const source = kernel.getObject("gear");
  assert.equal(binding.activationAbilities(source).length, 1);

  const draft = binding.describeActivate(source, "A", 0);
  assert.deepEqual(draft.cost.cost.payments, [
    { kind: "equip", value: { kind: "constant", value: { kind: "source" } } }
  ]);
  assert.throws(
    () => buildCostPlan(kernel.clone({ sourceSnapshot: source }), draft.cost),
    (error) =>
      error instanceof CostPlanError &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
  // effect.attach is never reached: nothing was attached and nothing was paid.
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(kernel.getObject("gear").exhausted, false);
});

test("sfd-051-221 Guardian Angel boundary: the printed Calm rune never reaches the merged expansion", () => {
  // programs/keywords.ts expandProgram calls KeywordDef.expand with only
  // value/host (contract 3.8.3 params.cost is not delivered), so the expansion
  // always keeps its generic placeholder instead of charging the printed Calm
  // Power. The card's own reviewed record keeps the printed domain.
  assert.deepEqual(expansionFor().map((ability) => ability.cost.payments), [
    [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  ]);
  assert.equal(expansionFor().some((ability) => JSON.stringify(ability).includes("Calm")), false);
  assert.equal(equip.costDomain, "Calm");
});

test.todo("sfd-051-221 Guardian Angel: paying the printed Calm Equip cost (CR 818.1.b / 818.1.c.3) needs an Equip payment kind in cost/plan-values.ts plus the KeywordDef.expand params.cost assembly path (contract 3.8 item 3).");
test.todo("sfd-051-221 Guardian Angel: assembling the card's KeywordAbility printed params into the expansion (contract 3.8.3) is not merged; the merged effect.attach body above runs directly, and payCostPlan is only exercised once the cost kind and the params.cost assembly exist.");
