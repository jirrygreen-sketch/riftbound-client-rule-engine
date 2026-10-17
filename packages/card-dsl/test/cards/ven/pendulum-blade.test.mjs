import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/pendulum-blade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { describeActivate } from "../../../../engine-core/dist/programs/activate.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CANONICAL =
  "card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c";
const SOURCE_TEXT =
  "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

/** The merged Equip expansion for this card's printed value (818.1.c.2). */
function expansionFor() {
  return expandProgram(program, equipWorld().source).expanded;
}

/** The Gear on the Board plus one controlled unit; printed characteristics stay as printed. */
function equipWorld() {
  // TestWorld compares player filters literally. Use a real player named self
  // to run the expanded body unchanged; ChainEngine normally binds this selector.
  const base = world().player("self")
    .unit("pendulum-blade", {
      owner: "self",
      controller: "self",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      energy: 3,
      power: null,
      might: 1,
      zone: "board",
      location: { type: "base", player: "self" }
    })
    .unit("ally", { might: 3, owner: "self", controller: "self" })
    .unit("enemy-unit", { owner: "B" })
    .build();
  // 827.1.b.1-style binding: the activation host is the live Gear instance.
  return base.clone({
    controller: "self",
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
  // The remaining gaps concern the printed cost and its payment semantics.
  assert.match(program.judgeReason, /818\.1\.c/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /cost\/plan-values\.ts/);
  assert.match(program.judgeReason, /programs\/keywords\.ts/);
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
    ...program,
    abilities: expansion
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
  kernel.setTargets("equip-target", [kernel.ref("ally")]);
  const outcome = resolveChainBody(expansion.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("pendulum-blade").attachedTo, kernel.ref("ally"));
  assert.deepEqual(outcome.events.map(event => event.action), ["attach"]);
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

  kernel.setTargets("equip-target", [stale]);
  const outcome = resolveChainBody(expansion.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
  assert.equal(kernel.getObject("pendulum-blade").attachedTo, null);
});

test("ven-011-166 Pendulum Blade golden: the expanded target filter rejects an opposing unit", () => {
  const kernel = equipWorld();
  const [expansion] = expansionFor();
  kernel.setTargets("equip-target", [kernel.ref("enemy-unit")]);
  const outcome = resolveChainBody(expansion.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("pendulum-blade").attachedTo, null);
});

test("ven-011-166 Pendulum Blade: the activation entry keeps the real card blocked until its Equip cost is supported", () => {
  const registry = new ProgramRegistry([program]);
  assert.throws(
    () => describeActivate(registry, equipWorld().source, "self"),
    error => error.code === "judge-required" && error.message === program.judgeReason
  );
});

test.todo(
  "ven-011-166 Pendulum Blade: pass the printed 1 Fury Power cost through programs/keywords.ts params.cost " +
    "into Equip.expand and plan/pay that cost instead of the descriptive equip payment (818.1.c)"
);
