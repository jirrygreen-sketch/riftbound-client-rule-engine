import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/twilight-reveler.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-06ec9960630fdb489ea65176cf2d899ccda0784b50dcc84efaf98e95381f6d46";
const SOURCE_TEXT = "When I attack, ready another friendly unit.";

const [ability] = program.abilities;
const [readyOther] = ability.body;
const targetSpec = readyOther.targets[0];

/**
 * Finalize locks the chosen "another friendly unit"; the card's own instruction
 * then runs unmodified (the merged pit-rookie / blind-monk convention).
 */
function runBody(kernel, chosenId = "ally") {
  const instructions = ability.body.map(({ targets, ...rest }) => rest);
  kernel.setTargets(targetSpec.id, [kernel.ref(chosenId)]);
  return resolveChainBody(instructions, kernel);
}

const board = (allyExhausted) =>
  world()
    .unit("reveler", { controller: "A", exhausted: false })
    .unit("ally", { controller: "A", exhausted: allyExhausted })
    .unit("enemy", { controller: "B", owner: "B", exhausted: true })
    .build();

test("ven-020-166 Twilight Reveler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-020-166 Twilight Reveler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /383\.4\.e/);
  // Refreshed 2026-10-17: the "another friendly unit" exclude anchor is also
  // rejected by the production card-binding translation.
  assert.match(program.judgeReason, /Unsupported filter field exclude/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
});

test("ven-020-166 Twilight Reveler: one per-combat Attack Trigger scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.e: "When I attack" is the closed attack-declared timing point;
  // 383.4.e.2.a checks the trigger condition only once per combat.
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, "per-combat");
  assert.equal(ability.trigger.condition, undefined);
});

test("ven-020-166 Twilight Reveler: one effect.ready targeting another friendly unit", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "twilight-reveler.ready-another-friendly-unit"
  ]);
  assert.equal(readyOther.op, "effect.ready");
  assert.deepEqual(readyOther.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "twilight-reveler.another-friendly-unit" }
  });
  assert.deepEqual(readyOther.args.amount, { kind: "constant", value: 1 });
  assert.equal(readyOther.linkedTo, undefined);
  assert.equal(readyOther.picks, undefined);
  // "another friendly unit": controller is the ability's controller and the
  // source itself is excluded (355.9.c, contract 3.6 exclude anchor).
  assert.deepEqual(targetSpec, {
    id: "twilight-reveler.another-friendly-unit",
    filter: {
      type: "unit",
      zone: "board",
      controller: "controller",
      exclude: "self"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-020-166 golden: the chosen friendly unit is readied (CR 416.1)", () => {
  const kernel = board(true);
  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["twilight-reveler.ready-another-friendly-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("ally").exhausted, false);
  // The source unit is never the card's own choice and the enemy unit is not
  // "friendly": only the chosen ally produces a ready action.
  assert.deepEqual(kernel.events.map((event) => event.action), ["ready"]);
  assert.equal(kernel.getObject("enemy").exhausted, true);
  assert.deepEqual(outcome.linkedValues["twilight-reveler.ready-another-friendly-unit.readied"], {
    count: 1,
    objects: [kernel.ref("ally")]
  });
});

test("ven-020-166 golden: an already-ready ally is a no-op, not an error (416.1.b/416.1.c)", () => {
  const kernel = board(false);
  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("ally").exhausted, false);
});

test("ven-020-166 golden: an ally that left the board makes the ready ignored (359.3.e.7)", () => {
  const kernel = board(true);
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const instructions = ability.body.map(({ targets, ...rest }) => rest);
  kernel.setTargets(targetSpec.id, [stale]);
  const outcome = resolveChainBody(instructions, kernel);

  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("ally").zone, "trash");
});

test("ven-020-166 Twilight Reveler golden: the production binder preserves the 'another' exclude anchor", () => {
  const [translated] = translateInstructionTargets(ability.body);
  assert.deepEqual(translated.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    exclude: "self"
  });
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const kernel = world().player("A").unit("reveler", { cardId: CANONICAL_ID }).build();
  assert.doesNotThrow(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: () => {}, unregisterTrigger: () => {} } }, kernel.getObject("reveler"))
  );
});

test("ven-020-166 Twilight Reveler probe: attack-declared has no producer in the merged combat flow", () => {
  // Executed evidence for judgeReason point 1: combat/flow.ts only documents the
  // blocked combat-start transaction; no merged code emits attack-declared.
  const flowSource = readFileSync(
    new URL("../../../../engine-core/src/combat/flow.ts", import.meta.url),
    "utf8"
  );
  assert.match(flowSource, /combat-start-transaction/);
  const emitSites = [...flowSource.matchAll(/emit\(\s*'([a-z-]+)'/g)].map((match) => match[1]);
  assert.ok(!emitSites.includes("attack-declared"), `flow.ts emits ${JSON.stringify(emitSites)}`);
});

test.todo(
  "ven-020-166 Twilight Reveler: the attack-declared timing point has no combat emitter; the existing " +
    "CardProgram trigger binding therefore cannot place 'When I attack' on the chain " +
    "(CR 383.4.e.2 / 383.4.e.2.a; combat/flow.ts still blocks the combat transaction)"
);
