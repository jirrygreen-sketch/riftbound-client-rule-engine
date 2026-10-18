// Keyword expansion is also checked in ../templates/keyword-only.test.mjs;
// attachment sub-effect execution and the remaining payment block are below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/serrated-dirk.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2";
const SOURCE_TEXT =
  "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The Gear as it sits on the Board; printed energy/power/might stay untouched. */
function equipWorld() {
  const base = world()
    .object("gear", {
      name: "Serrated Dirk",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 1,
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

test("sfd-009-221 Serrated Dirk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-009-221 Serrated Dirk: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // Name the current binding gaps instead of already-merged task numbers.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /818\.1\.c\.2/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /cost\/plan-values\.ts::readCost/);
  assert.match(program.judgeReason, /programs\/keywords\.ts/);
  assert.match(program.judgeReason, /effects\/keywords\/Equip\.ts/);
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes this exact program object.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-009-221 Serrated Dirk: one valued Fury Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test("sfd-009-221 Serrated Dirk: the merged Equip expansion is valid EffectIR for this card", () => {
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

test("sfd-009-221 Serrated Dirk golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
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
  assert.equal(kernel.getObject("gear").might, 0);
});

test("sfd-009-221 Serrated Dirk golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
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

test("sfd-009-221 Serrated Dirk: the shipped program stays gated before an unpaid activation", () => {
  const kernel = equipWorld();
  const before = kernel.snapshot();
  const binding = createProgramBinding({ cardPrograms: [program] });

  assert.throws(
    () => binding.describeActivate(kernel.getObject("gear"), "A"),
    error => error.code === "judge-required" && error.message === program.judgeReason
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(kernel.getObject("gear").energy, 1);
  assert.equal(kernel.getObject("gear").power, null);
  assert.equal(kernel.getObject("gear").might, 0);
});

test("sfd-009-221 Serrated Dirk: the merged CardProgram binding builds the activation draft with its Equip payment", () => {
  // Preserve evidence that activation binding works independently of the
  // missing printed Equip-cost path. The body alone never proves payment.
  const source = equipWorld().getObject("gear");
  // The registry refuses judge-required programs (ProgramRegistry.get), so the
  // binding path is exercised against the same abilities with the status lifted
  // for this scenario only; the shipped program keeps judge-required.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const draft = binding.describeActivate(source, "A");

  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.cost.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(draft.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
});

test.todo("sfd-009-221 Serrated Dirk: paying the printed Fury Equip cost (CR 818.1.b / 818.1.c.3) needs a supported cost plan instead of Equip.ts's unsupported equip payment kind.");
test.todo("sfd-009-221 Serrated Dirk: the printed 1 Fury Power must flow from KeywordAbility through programs/keywords.ts and Equip.ts params.cost into Finalize (CR 818.1.c.2–4).");
// Direct evidence for the recorded cost gap: the merged cost pipeline refuses
// the equip payment kind before any payment can be assessed (CR 818.1.b /
// 818.1.c.2). The printed Fury cost stays descriptive until that binding exists.

test("sfd-009-221 Serrated Dirk: the merged cost pipeline rejects the equip payment kind (CR 818.1.b / 818.1.c.2)", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();

  assert.throws(
    () => buildCostPlan(kernel, { id: "serrated-dirk.equip", cost: expansion.cost }),
    (error) => {
      assert.ok(error instanceof CostPlanError);
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});
