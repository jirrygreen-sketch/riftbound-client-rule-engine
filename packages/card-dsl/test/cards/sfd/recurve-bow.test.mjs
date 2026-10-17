import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/recurve-bow.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-553d60be98d221dc71d4e71eb6ae5938143fa0c4b71e6e96d27d8570521d36eb";
const SOURCE_TEXT =
  "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The Gear as it sits on the Board; printed energy/power/might stay untouched. */
function equipWorld() {
  const base = world()
    .object("gear", {
      name: "Recurve Bow",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 2,
      power: null,
      might: 0
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

test("sfd-016-221 Recurve Bow: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-016-221 Recurve Bow: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason names the missing payment path and the real dependencies.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes this exact program object.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-016-221 Recurve Bow: one valued Fury Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test("sfd-016-221 Recurve Bow: the merged Equip expansion is valid EffectIR for this card", () => {
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

test("sfd-016-221 Recurve Bow golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
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
  assert.equal(kernel.getObject("gear").might, 0);
});

test("sfd-016-221 Recurve Bow golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
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
  // The Gear kept its printed, unattached state: the attach never happened
  // (150.2/150.4 characteristics are also left untouched).
  assert.deepEqual(run.events.filter((event) => event.action === "attach"), []);
  assert.equal(kernel.getObject("gear").attachedTo, null);
});

test("sfd-016-221 Recurve Bow: the merged Equip expansion really attaches this Gear to a controlled Unit", () => {
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
});

test.todo("sfd-016-221 Recurve Bow: paying the printed Fury Equip cost (CR 818.1.b / 818.1.c.3) needs an equip payment kind in cost/plan-values.ts; the KeywordDef.expand signature already exposes params.cost but Equip.ts does not read it yet (contract 3.8 item 3; RIFT-261 follow-up).");
test.todo("sfd-016-221 Recurve Bow: the card-program -> keyword expansion path is merged (RIFT-257 programs/keywords.ts); the activation cost becomes payable once the equip payment kind and the printed-cost binding exist, at which point payCostPlan can be exercised end to end.");
// Direct evidence for the two printed-cost gaps recorded in the judgeReason:
// the merged cost pipeline refuses the equip payment kind outright, and the
// Equip KeywordDef still ignores the params.cost carrier promised by
// contract 3.8 item 3.
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";

test("sfd-016-221 Recurve Bow: the merged cost pipeline rejects the equip payment kind (CR 818.1.b / 818.1.c.2)", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();

  assert.throws(
    () => buildCostPlan(kernel, { id: "recurve-bow.equip", cost: expansion.cost }),
    (error) => {
      assert.ok(error instanceof CostPlanError);
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});

test("sfd-016-221 Recurve Bow: Equip.expand still ignores params.cost, so the printed Fury cost never reaches the plan", () => {
  // Contract 3.8 item 3: the caller may pass the printed equip cost through
  // params.cost. The merged Equip.ts signature accepts the carrier but its
  // expand body never reads it — the returned activation cost stays the bare
  // equip payment kind, which the cost pipeline then blocks (see the test
  // above). This locks the exact unbound shape until RIFT-261 lands.
  const definition = keywordDefinitionsById.get("Equip");
  const [expansion] = definition.expand({
    value: equip.value,
    host: { canonicalCardId: CANONICAL },
    params: { cost: { kind: "explicit", power: { kind: "constant", value: 1 } } }
  });
  assert.deepEqual(expansion.cost, {
    kind: "activated",
    payments: [{ kind: "equip", value: { kind: "constant", value: { kind: "source" } } }]
  });
});
