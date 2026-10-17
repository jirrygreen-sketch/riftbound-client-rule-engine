import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/dorans-shield.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46";
const SOURCE_TEXT =
  "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The Gear as it sits on the Board; printed energy/power/might stay untouched. */
function equipWorld() {
  const base = world()
    .object("gear", {
      name: "Doran's Shield",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
      power: null,
      might: 1
    })
    .unit("ally", { might: 2 })
    .unit("enemy-unit", { owner: "B" })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("gear") });
}

function expansionFor() {
  const binding = createProgramBinding({ cardPrograms: [program] });
  return binding.inspect(equipWorld().getObject("gear")).abilities
    .filter((ability) => ability.kind === "activated");
}

test("sfd-033-221 Doran's Shield: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-033-221 Doran's Shield: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason names the missing payment path and the real dependencies.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /readCost/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes this exact program object.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-033-221 Doran's Shield: one valued Calm Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Calm");
});

test("sfd-033-221 Doran's Shield: the merged Equip expansion is valid EffectIR for this card", () => {
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

test("sfd-033-221 Doran's Shield golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
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
  assert.equal(kernel.getObject("gear").energy, 1);
  assert.equal(kernel.getObject("gear").power, null);
  assert.equal(kernel.getObject("gear").might, 1);
});

test("sfd-033-221 Doran's Shield golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
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

test("sfd-033-221 Doran's Shield golden: the merged Equip activation declares its cost components", () => {
  // 818.1.c.2: functionally "[Cost]: Attach this gear to a unit you control."
  // This asserts the expansion's own cost shape; whether the cost pipeline can
  // pay it is the unmerged dependency recorded in judgeReason and the todos.
  const [expansion] = expansionFor();

  assert.equal(expansion.cost.kind, "activated");
  assert.deepEqual(expansion.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(expansion.cost.payments[0].value, { kind: "constant", value: { kind: "source" } });
});

test("sfd-033-221 Doran's Shield: the merged cost pipeline still refuses the Equip payment kind", () => {
  // CR 818.1.c.2: the printed Calm Power must become a payable activation cost.
  // cost/plan-values.ts readCost has no equip payment kind, so the merged plan
  // builder fails closed instead of inventing a cost.
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  assert.throws(
    () => buildCostPlan(kernel, { id: "cost:dorans-shield", cost: expansion.cost }),
    (error) => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
  assert.equal(kernel.getObject("gear").attachedTo, null);
});

test.todo("sfd-033-221 Doran's Shield: paying the printed Calm Equip cost (CR 818.1.b / 818.1.c.3) needs an Equip payment kind in cost/plan-values.ts plus the ExpandInput params.cost plumbing (contract 3.8 item 3).");
test("sfd-033-221 Doran's Shield: the real card-program adapter expands the Equip ability", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const inspected = binding.inspect(equipWorld().getObject("gear"));
  assert.equal(inspected.program.canonicalCardId, CANONICAL);
  assert.deepEqual(inspected.abilities[0], equip);
  assert.equal(inspected.abilities[1].kind, "activated");
  assert.deepEqual(inspected.abilities[1].body[0].targets[0].filter, { type: "unit", controller: "self" });
});
