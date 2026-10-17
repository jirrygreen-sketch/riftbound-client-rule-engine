import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/kinkou-initiate.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-578f670d7fdae87fd32e34179e331f901a8f108dcb51c337c971db00b3e3c498";
const SOURCE_TEXT = "When you play me, draw 1 if your other units have total Might 5 or more.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("unl-097-219 Kinkou Initiate: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-097-219 Kinkou Initiate: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /total Might/);
  assert.match(program.judgeReason, /count/);
  // The trigger/draw half now binds (RIFT-257); the reason must name the
  // sum-over-set expression and the rejected exclude anchor.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /exclude/);
});

test("unl-097-219 Kinkou Initiate: 'when you play me' trigger is the card-played Play Effect", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-097-219 Kinkou Initiate: the gate sits on the draw instruction, not on the trigger", () => {
  // 383.2.a.1: "if …" follows the instruction, so it is part of the Effect; the
  // Loose Cannon example in the Core Rules has the same structure.
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "kinkou-initiate.draw");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // The draw is the implicit "you" = the ability controller (190.6.d).
  assert.equal(drawInstruction.args.player, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);

  const condition = drawInstruction.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-friendly-units-total-might");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    exclude: "self"
  });
});

test("unl-097-219 Kinkou Initiate golden: the merged effect.draw instruction really draws 1", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-097-219 Kinkou Initiate: the retained sum-of-Might gate does not evaluate as a count", () => {
  // 143.2.a.1: "total Might" is the sum of Effective Might over the filtered set.
  // The merged `count` expression counts objects, so the placeholder subject and
  // its filter must not be read as an equivalent gate: three 1-Might units count
  // as 3 even though their total Might is also 3, and a single 4-Might unit
  // counts as 1 while its Might is 4 — the two differ by construction.
  const kernel = world()
    .unit("strong", { might: 4 })
    .unit("weak", { might: 1 })
    .build();
  const counted = kernel.query({
    type: "unit",
    controller: "A",
    exclude: "self"
  }).length;
  assert.equal(counted, 2, "the placeholder counts objects, not Might");
  const totalMight = kernel
    .query({ type: "unit", controller: "A" })
    .reduce((sum, unit) => sum + unit.might, 0);
  assert.equal(totalMight, 5);
  assert.notEqual(counted, totalMight);
});

test("unl-097-219 Kinkou Initiate golden: the card-played trigger registers through the merged program binding", async () => {
  // programs/filters.ts normalises {source: "self"} to the host object filter
  // and programs/triggers.ts registers the subscription; both halves of the
  // Play Effect are therefore merged.
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "initiate", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 3 }], describePlay: binding.describePlay });
  const snapshot = { ...f.kernel.getObject("initiate"), cardId: CANONICAL_ID, zone: "board" };

  const ids = binding.registerProgramTriggers(f.engine, snapshot);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^program:initiate:1:/);
});

test("unl-097-219 Kinkou Initiate: the retained count gate is not the printed Might sum", async () => {
  // Evidence for the remaining gap: the merged instruction path really runs the
  // card's own body, but the retained "count" placeholder is not the printed
  // sum-of-Effective-Might gate. Two of the controller's other units make
  // count = 2 while their total Might is 1 + 4 = 5, so the same world passes a
  // Might sum and fails the count: the gate cannot be bound honestly.
  const { resolveChainBody } = await import("../../../../engine-core/dist/chain/interpreter-adapter.js");
  const { translateInstructionTargets } = await import("../../../../engine-core/dist/programs/filters.js");
  const kernel = world()
    .unit("initiate", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("weak-ally", { owner: "A", controller: "A", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("strong-ally", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .deck(["top", "second"])
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("initiate"), controller: "A" });

  // 143.2.a.1: the printed gate is the sum of Effective Might over the filtered
  // set, which is exactly the printed threshold here.
  const totalMight = kernel
    .query({ type: "unit", zone: "board", controller: "A" })
    .filter(unit => unit.ref.id !== "initiate")
    .reduce((sum, unit) => sum + unit.might, 0);
  assert.equal(totalMight, 5);
  // The merged Expr can only count the set, and the count is 2.
  assert.equal(ctx.test(drawInstruction.condition), false);

  const outcome = resolveChainBody(translateInstructionTargets(ability.body), ctx);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    [outcome.results[0].result.status, outcome.results[0].result.reason],
    ["negated", "skipped"]
  );
  assert.equal(ctx.player("A").handSize, 0);
});

test.todo(
  "unl-097-219 Kinkou Initiate: evaluate 'your other units have total Might 5 or more' " +
    "as a sum of Effective Might over the filtered set (143.2.a.1) — the frozen Expr algebra has " +
    "no sum-over-set form (contract 3.2 Expr); depends on the expression condition pipeline (RIFT-9 expression inventory)"
);
