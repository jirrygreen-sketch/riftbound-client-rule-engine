import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/dune-drake.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so dependency evidence loads the built engine through its
// workspace layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", engineCore));

const CANONICAL = "card.hash-129e18f9d31400f8fce66c0a8cb60d4ca43ce586a107ec18cb24bee9d79e81d9";
const [attackTrigger] = program.abilities;
const grantInstruction = attackTrigger.body[0];

test("Dune Drake program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.equal(
    program.sourceText,
    "When I attack, give me +2 :rb_might: this turn if there is a ready enemy unit here."
  );
});

test("structure: attack trigger filtered to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.trigger.once, undefined);
});

test("structure: the 'if there is a ready enemy unit here' clause is the Trigger Condition", () => {
  // CR 383.2.a.1: a conditional statement immediately after the Condition is
  // part of the Trigger Condition, not the effect — so it lives on the trigger,
  // as a count of ready enemy units at the source's location.
  assert.deepEqual(attackTrigger.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "ready-enemy-units-here",
      filter: {
        type: "unit",
        controller: "opponent",
        states: "ready",
        sameLocationAs: "source"
      }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("structure: body grants +2 Might for this turn through the layers contract shape", () => {
  assert.equal(attackTrigger.body.length, 1);
  assert.equal(grantInstruction.id, "dune-drake.grant-might");
  assert.equal(grantInstruction.op, "continuous.might");
  assert.deepEqual(grantInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the host, not a chosen target (CR 355.10.d): the symbolic
  // selector "self" is used, never a fabricated TargetSpec or ObjectRef.
  assert.deepEqual(grantInstruction.args.object, { kind: "constant", value: "self" });
  assert.equal(grantInstruction.targets, undefined);
  assert.equal(grantInstruction.picks, undefined);
  assert.equal(grantInstruction.linkedTo, undefined);
});

test("dependency evidence: no merged instruction implements a Might modification", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(instructionDefinitionsById.has("effect.might-modify"), false);
  // The temporally-bounded Might change is not a Buff counter (CR 702/703).
  assert.equal(instructionDefinitionsById.has("effect.buff"), true);
});

test.todo(
  "Dune Drake: 'give me +2 [M] this turn' needs continuous.might with an end-of-turn duration " +
    "(layers, CR 479 / 143.2.a) — not implemented (RIFT-83/84/91). Buff counters are not equivalent " +
    "(CR 702/703)"
);
test.todo(
  "Dune Drake: the trigger only becomes reachable when the combat flow emits attack-declared " +
    "(CR 383.4.e / 466.2.c); engine batch 5 combat emits no timing points today"
);
