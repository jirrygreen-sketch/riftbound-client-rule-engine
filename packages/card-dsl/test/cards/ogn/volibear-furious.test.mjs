// RIFT-664 template execution evidence (trigger -> Finalize target locking,
// split-damage divide-literal gap, sameLocationAs binding rejection) is in
// ../templates/keyword-triggered-attack-declared-effect-664.test.mjs. This
// card stays judge-required for the printed gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/volibear-furious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-3945b807e4fed55c0e3bd1ea8f5f24a46e04bea3379a8e559da6db0f73a173cc";
const SOURCE_TEXT =
  "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When I attack, deal 5 damage split among any number of enemy units here.";

const [deflect, triggered] = program.abilities;
const splitInstruction = triggered.body[0];
const targetSpec = splitInstruction.targets[0];

/** Run the card's damage instruction with the given locked target objects. */
function splitDamage(kernel, objectIds, answers = {}) {
  return runInstruction(
    damage,
    {
      amount: splitInstruction.args.amount,
      target: targetSpec.id,
      divide: true
    },
    {
      world: kernel,
      targets: { [targetSpec.id]: objectIds.map((id) => kernel.ref(id)) },
      answers
    }
  );
}

test("ogn-041-298 Volibear, Furious: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-041-298 Volibear, Furious: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /rainbow/);
  // 2026-10-17 re-check: the printed here anchor and the divide literal are
  // both still rejected on the merged production path.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.match(program.judgeReason, /355\.14/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-041-298 Volibear, Furious: [Deflect 2] is a valued keyword ability", () => {
  // 809.1.b: Deflect is formatted "Deflect [X]"; X = 2 here. The expansion
  // (target tax of two rainbow runes, 809.1.b.1/.b.2) stays in
  // effects/keywords/Deflect.ts and the target/cost systems.
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect", value: 2 });
});

test("ogn-041-298 Volibear, Furious: attack trigger is per-combat and filtered to self", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "attack-declared");
  assert.deepEqual(triggered.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // 383.4.e.2.a: the condition is checked once per combat.
  assert.equal(triggered.trigger.once, "per-combat");
  assert.equal(triggered.optional, false);
});

test("ogn-041-298 Volibear, Furious: split 5 damage among up to five enemy units here", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(splitInstruction.id, "volibear.split-damage");
  assert.equal(splitInstruction.op, "effect.damage");
  assert.deepEqual(splitInstruction.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(splitInstruction.args.target, {
    kind: "constant",
    value: "volibear.enemy-units-here"
  });
  // 355.14: the split flag; the per-target share is decided at resolution.
  assert.deepEqual(splitInstruction.args.divide, { kind: "literal", value: true });
  assert.equal(splitInstruction.args.source, undefined);

  // 355.13/355.14.c: "any number" includes zero, and the number of Targets
  // cannot exceed the initial damage. "here" is the 359.3.f referent to the
  // source's location.
  assert.equal(splitInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "volibear.enemy-units-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 0,
    max: 5,
    selection: "up-to"
  });
});

test("ogn-041-298 Volibear, Furious golden: 5 damage splits across two enemy units at resolution", () => {
  const kernel = world()
    .unit("enemy-one", { owner: "B", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-two", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();

  const run = splitDamage(kernel, ["enemy-one", "enemy-two"], {
    "effect.damage:divide:0": 3,
    "effect.damage:divide:1": 2
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-one").damage, 3);
  assert.equal(kernel.getObject("enemy-two").damage, 2);
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["damage", "damage"]);
});

test("ogn-041-298 Volibear, Furious golden: the whole 5 can go to a single unit", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .build();

  const run = splitDamage(kernel, ["enemy"], { "effect.damage:divide:0": 5 });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 5);
  assert.equal(run.linked.dealt, 5);
});

test("ogn-041-298 Volibear, Furious golden: the resolution suspends for the split decision (CR 355.14.e)", () => {
  const kernel = world()
    .unit("enemy-one", { owner: "B", might: 3 })
    .unit("enemy-two", { owner: "B", might: 2 })
    .build();

  const asked = splitDamage(kernel, ["enemy-one", "enemy-two"]);
  assert.ok(asked.asked, "the split choice must suspend the instruction");
  assert.equal(asked.result, null);
  // The rollback leaves the world untouched until the answer is replayed.
  assert.equal(kernel.getObject("enemy-one").damage, 0);
  assert.equal(kernel.getObject("enemy-two").damage, 0);
});

test("ogn-041-298 Volibear, Furious golden: an illegal split answer negates the instruction (CR 355.14.f/.g)", () => {
  const kernel = world()
    .unit("enemy-one", { owner: "B", might: 3 })
    .unit("enemy-two", { owner: "B", might: 2 })
    .build();

  const run = splitDamage(kernel, ["enemy-one", "enemy-two"], {
    "effect.damage:divide:0": 6
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("enemy-one").damage, 0);
  assert.equal(kernel.getObject("enemy-two").damage, 0);
});

test("ogn-041-298 Volibear, Furious golden: no legal enemy unit here is ignored, not an error", () => {
  const kernel = world().build();
  const run = splitDamage(kernel, []);
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test("ogn-041-298 Volibear, Furious golden: a target that left its zone is dropped and the rest still splits", () => {
  const kernel = world()
    .unit("staying", { owner: "B", might: 3 })
    .unit("leaving", { owner: "B", might: 2 })
    .build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    damage,
    { amount: splitInstruction.args.amount, target: targetSpec.id, divide: true },
    {
      world: kernel,
      targets: { [targetSpec.id]: [kernel.ref("staying"), stale] },
      answers: { "effect.damage:divide:0": 5 }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 5);
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 1);
});

// ---------------------------------------------------------------------------
// Not executable — TODO items with real causes (see judgeReason).
// ---------------------------------------------------------------------------

test.todo(
  "ogn-041-298 Volibear, Furious: the attack trigger firing needs an emitter for the " +
    "attack-declared timing point (383.4.e/347.2.a); combat/flow.ts still throws " +
    "combat-start-transaction for combat start (P0 contract 7.2 batch 5 Turn/Combat)"
);

test.todo(
  "ogn-041-298 Volibear, Furious: the [Deflect 2] target tax (809.1.b.1/.b.2: opponents pay " +
    "two rainbow runes) needs target-plan and cost-plan payment typing; the merged target.tax " +
    "consumer currently appends an energy-shaped mandatory additional cost"
);
