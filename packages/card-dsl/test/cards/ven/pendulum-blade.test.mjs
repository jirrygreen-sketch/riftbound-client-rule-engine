import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/pendulum-blade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import attach from "../../../../engine-core/dist/effects/instructions/effect.attach.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c";
const SOURCE_TEXT =
  "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The merged Equip expansion for this card's printed value (818.1.c.2). */
function expansionFor() {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  return definition.expand({
    value: equip.value,
    host: { canonicalCardId: CANONICAL }
  });
}

/** The Gear on the Board plus one controlled unit; printed characteristics stay as printed. */
function equipWorld() {
  const base = world()
    .unit("pendulum-blade", {
      types: ["gear"],
      tags: ["Equipment"],
      energy: 3,
      power: null,
      might: 1,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 3 })
    .unit("enemy-unit", { owner: "B" })
    .build();
  // 827.1.b.1-style binding: the activation host is the live Gear instance.
  return base.clone({
    source: base.ref("pendulum-blade"),
    sourceSnapshot: base.getObject("pendulum-blade")
  });
}

test("ven-011-166 Pendulum Blade: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-011-166 Pendulum Blade: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The judgeReason names the two real gaps: the keyword wiring and the
  // unpayable printed Equip cost.
  assert.match(program.judgeReason, /818\.1\.c/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-011-166 Pendulum Blade: one valued Fury Equip keyword (CR 818.1.c)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // value records the printed Power amount, costDomain the Power's domain.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test("ven-011-166 Pendulum Blade: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  const expansion = expansionFor();
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues));

  // 818.1.c.2: functionally "[Cost]: Attach this gear to a unit you control."
  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["equip-attach", "effect.attach"]
  ]);
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target, limited to units you control.
  assert.deepEqual(ability.body[0].targets, [
    {
      id: "equip-target",
      filter: { type: "unit", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-011-166 Pendulum Blade golden: the merged Equip body attaches this Gear to a controlled Unit", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  const run = runInstruction(
    // The merged effect.attach primitive is the body this card's Equip owns.
    attach,
    { host: expansion.body[0].args.host },
    { world: kernel, targets: { "equip-target": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("pendulum-blade").attachedTo, kernel.ref("ally"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
  // 150.2 / 150.4: the printed Equipment characteristics are never coerced.
  assert.equal(kernel.getObject("pendulum-blade").energy, 3);
  assert.equal(kernel.getObject("pendulum-blade").power, null);
  assert.equal(kernel.getObject("pendulum-blade").might, 1);
});

test("ven-011-166 Pendulum Blade golden: a controlled Unit that left the Board is ignored (CR 359.3.e.6)", () => {
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
  assert.equal(kernel.getObject("pendulum-blade").attachedTo, null);
});

test.todo(
  "ven-011-166 Pendulum Blade: paying the printed Equip cost (1 Fury Power, CR 818.1.c) needs the \"equip\" " +
    "payment kind in cost/plan-values.ts and the contract 3.8.3 params.cost input on KeywordDef.expand (RIFT-89)"
);
test.todo(
  "ven-011-166 Pendulum Blade: the card-program -> keyword expansion -> chain activation wiring (contract 3.5) " +
    "must register the Equip activated ability before the whole card is executable (RIFT-120 follow-up)"
);
