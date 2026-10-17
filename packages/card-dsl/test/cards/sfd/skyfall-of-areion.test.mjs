import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/skyfall-of-areion.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-63dae663a2ca549dc4704d2814cdc3b2eea4a26845d09029e88d2c8df6ee0013";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The Gear as it sits on the Board; printed energy/power/might stay untouched. */
function equipWorld() {
  const base = world()
    .object("gear", {
      name: "Skyfall of Areion",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: null,
      might: 2
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

test("sfd-030-221 Skyfall of Areion: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-030-221 Skyfall of Areion: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason names the missing payment path and the real dependencies.
  assert.match(program.judgeReason, /Equip/);
  assert.match(program.judgeReason, /818\.1\.c\.3/);
  assert.match(program.judgeReason, /params\.cost/);
  // The remaining gap is the cost pipeline’s unsupported equip payment kind;
  // the keyword definition and CardProgram binding are merged.
  assert.match(program.judgeReason, /Unsupported payment kind: equip/);
  assert.match(program.judgeReason, /payments/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes this exact program object.
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-030-221 Skyfall of Areion: one valued Fury Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test("sfd-030-221 Skyfall of Areion: the merged Equip expansion is valid EffectIR for this card", () => {
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

test("sfd-030-221 Skyfall of Areion golden: the merged Equip attach body attaches this Gear to a controlled Unit", () => {
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
  assert.equal(kernel.getObject("gear").energy, 3);
  assert.equal(kernel.getObject("gear").power, null);
  assert.equal(kernel.getObject("gear").might, 2);
});

test("sfd-030-221 Skyfall of Areion golden: a controlled Unit that left the Board is ignored, not re-attached (CR 359.3.e.6)", () => {
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

test("sfd-030-221 Skyfall of Areion: the merged CardProgram binding builds the activation draft with its Equip payment", () => {
  // Durable structural guard: the merged program adapter must keep deriving the
  // card's activated ability and carrying its declared Equip payment into the
  // chain cost plan. Whether that cost kind is payable is still unsupported by
  // the cost pipeline and is recorded as a TODO; this locks the binding
  // contract that must hold forever.
  const source = equipWorld().getObject("gear");
  // ProgramRegistry refuses judge-required programs, so bind a copy with the
  // status lifted for this scenario only; the shipped program stays
  // judge-required.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const draft = binding.describeActivate(source, "A");

  assert.equal(draft.kind, "activated");
  assert.equal(draft.speed, "action");
  assert.deepEqual(draft.cost.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(draft.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
});

test.todo("sfd-030-221 Skyfall of Areion: paying the printed mixed Equip cost (1 Energy + 1 Fury Power, CR 818.1.b / 818.1.c.3) needs the equip payment kind and the printed-cost flow through ExpandInput params.cost (contract 3.8 item 3).");
test.todo("sfd-030-221 Skyfall of Areion: KeywordAbility -> expand params.cost must carry the mixed printed cost (programs/keywords.ts currently passes value/host only) before verifyFinalize can pay it through the Finalize cost plan.");

test("sfd-030-221 Skyfall of Areion: the merged cost pipeline refuses the Equip payment declaration (CR 818.1.b/818.1.c.3)", () => {
  // The still-current blocker: the expansion's whole payment component is
  // unsupported, so even the Energy half of the mixed printed cost cannot be
  // planned or paid at Finalize.
  const kernel = equipWorld();
  const context = bindResolveContext(kernel, { source: kernel.getObject("gear") });
  assert.throws(
    () => buildCostPlan(context, {
      id: "skyfall-equip-activation",
      cost: { payments: [{ kind: "equip", value: { kind: "source" } }] }
    }),
    (error) => {
      assert.equal(error.reason, "judge-required");
      assert.match(error.message, /Unsupported payment kind: equip/);
      return true;
    }
  );
});

test("sfd-030-221 Skyfall of Areion: expand receives no printed cost, so the mixed Equip cost is not carried into params.cost", () => {
  // programs/keywords.ts passes only value/host, and the card's keyword ability
  // has no field that could carry the Energy half — the printed mixed cost has
  // no path into the expansion today.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
  assert.equal(Object.hasOwn(equip, "cost"), false);
  assert.equal(Object.hasOwn(equip, "energy"), false);
  const [ability] = expansionFor();
  assert.deepEqual(ability.cost.payments.map(payment => payment.kind), ["equip"]);
  // The expansion's payment is the `equip` placeholder, not the printed
  // 1 Energy + 1 Fury Power plan.
  assert.equal(ability.cost.payments.length, 1);
  assert.equal(ability.cost.energy, undefined);
});
