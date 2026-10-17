import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wielder-of-water.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core, so golden execution loads
// the built engine through its workspace layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: continuousMight } = await import(new URL("effects/instructions/continuous.might.js", engineCore));
const { createLayerEngine } = await import(new URL("layers/index.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL =
  "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef";
const SOURCE_TEXT = "While I'm attacking or defending alone, I have +2 :rb_might:.";

const [staticAbility] = program.abilities;

test("ogn-055-298 Wielder of Water: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-055-298 Wielder of Water: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-055-298 Wielder of Water: the +2 Might is a static arithmetic-layer effect on self", () => {
  // 364.3/364.3.a: a Conditional Passive Ability; 365.1: active while on the
  // Board. The effect never enters the chain (contract 3.4).
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.equal(staticAbility.effect.appliesTo, "self");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 2 });
  assert.equal(staticAbility.effect.value, undefined);
});

test("ogn-055-298 Wielder of Water golden: the merged continuous.might primitive applies +2 through the real layer engine", () => {
  // The declared amount/mode/layer reach the layer engine through the merged
  // instruction primitive. (The card-program static registration and the
  // condition evaluation are the still-missing halves — see judgeReason.)
  const kernel = world().unit("wielder", { might: 2 }).build();
  // The card's static ability targets its own host, so bind the source
  // snapshot the way the card-program static path would.
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("wielder") });
  const run = runInstruction(
    continuousMight,
    {
      amount: staticAbility.effect.amount,
      mode: { kind: "constant", value: staticAbility.effect.mode },
      duration: { kind: "constant", value: "this-turn" },
      appliesTo: { kind: "constant", value: "self" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);

  const engine = createLayerEngine([scoped.getObject("wielder")], [
    { effect: scoped.continuousEffects[0].effect, duration: scoped.continuousEffects[0].duration, timestamp: 1 }
  ]);
  engine.setObjects([scoped.getObject("wielder")]);
  assert.equal(engine.evaluate(scoped.ref("wielder")).might, 4);
});

test("ogn-055-298 Wielder of Water: the condition is combat role plus the lone predicate", () => {
  const condition = staticAbility.condition;
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 2);

  // "I'm attacking or defending": the merged IR has no designation field
  // (contract 3.8 combatRole); the program states the predicate it needs.
  const combat = condition.conditions[0];
  assert.equal(combat.kind, "expression");
  assert.deepEqual(combat.value, {
    kind: "constant",
    value: "self-in-combat-as-attacker-or-defender"
  });

  // "alone" (740.2.a): no other friendly unit at the same location.
  const lone = condition.conditions[1];
  assert.equal(lone.kind, "compare");
  assert.equal(lone.operator, "eq");
  assert.deepEqual(lone.right, { kind: "constant", value: 0 });
  assert.equal(lone.left.kind, "count");
  assert.deepEqual(lone.left.filter, {
    type: "unit",
    controller: "self",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test.todo(
  "ogn-055-298 Wielder of Water: the conditional +2 Might needs a merged layers consumer for " +
    "continuous.might with a card-program registration path (RIFT-257); the instruction primitive " +
    "and the layer arithmetic are merged and covered by the golden above."
);

test.todo(
  "ogn-055-298 Wielder of Water: the 'attacking or defending' half needs the combat designation " +
    "on ObjectSnapshot (contract 3.8 combatRole is in effects/contract.ts) plus its evaluation in " +
    "the layers engine: conditionMatches still only recognizes always/never/type/has-tag/has-keyword " +
    "and treats unknown conditions as true"
);

test.todo(
  "ogn-055-298 Wielder of Water: the 'alone' predicate (740.2.a, no other friendly unit at the " +
    "same location) has no merged evaluator in the static-effect layer path: layers/filter.ts " +
    "implements no sameLocationAs anchor (verified over-match), and the interpreter-side anchor " +
    "resolution is not reachable from a static ability"
);

test.todo(
  "ogn-055-298 Wielder of Water: no merged code turns a card program's static ability into a " +
    "registered continuous layer effect (no addContinuous caller in the card-program path; RIFT-257)"
);
