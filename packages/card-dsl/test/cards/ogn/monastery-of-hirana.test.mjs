import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/monastery-of-hirana.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
// The production card-body entry point (chain/engine.ts resolveChainBody) keeps
// the card's Expr arguments inside the literal envelope each primitive schema
// expects; the raw interpreter evaluates first, which effect.draw rejects.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const [ability] = program.abilities;
const [choice] = ability.body;
const [spendBuff, drawInstruction] = choice.args.body.value;

// Finalize-time target locking is supplied by the caller (interpreter README:
// the production caller owns Make Relevant Choices/Finalize). The reference
// kernel compares filters literally, so the "controller" placeholder never
// matches there — the merged goldens therefore hand the finalized target to
// the kernel directly (`setTargets`) and drop only the TargetSpec, keeping the
// card's own instructions, links and conditions. See pit-rookie's golden test.
const stripTargets = ({ targets, ...instruction }) => instruction;
const bodyOf = instructions => ({
  ...choice,
  args: {
    ...choice.args,
    body: { kind: "constant", value: instructions }
  }
});
const fullBody = [bodyOf([stripTargets(spendBuff), drawInstruction])];
const spendOnlyBody = [bodyOf([stripTargets(spendBuff)])];

test("ogn-282-298 Monastery of Hirana: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-282-298 Monastery of Hirana: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-7616fe7692fc8b3e1bf7fcdbe41d93a4d08639e4c541b02a6378293a286e0550"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-282-298) carries this text verbatim; CR 383.1 uses
  // this exact printing as its example of a triggered ability.
  assert.equal(program.sourceText, "When you conquer here, you may spend a buff to draw 1.");
  // Re-sweep: the scoring wave and program trigger registration are merged;
  // the remaining gaps are the Finalize-locked instruction cost and the
  // location anchor for "here".
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /details\.battlefieldId/);
  assert.match(program.judgeReason, /RIFT-357/);
});

test("ogn-282-298 Monastery of Hirana: optional conquer trigger with the §3.9 body-wrapped shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.c.1 / 383.4.c.2.b: a Conquer Effect of this battlefield's
  // controller (timing point "conquer", CR 468.5.d / 471.1 / 473.2.a).
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "controller" });
  assert.equal(ability.optional, true);

  assert.equal(ability.body.length, 1);
  assert.equal(choice.id, "monastery-of-hirana.opt-in");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(entry => entry.id), [
    "monastery-of-hirana.spend-buff",
    "monastery-of-hirana.draw"
  ]);
  // Contract 3.9: no choice-plus-linkedTo shape; the chosen instructions are
  // wrapped in the optional body.
  assert.equal(choice.linkedTo, undefined);
  assert.equal(spendBuff.linkedTo, undefined);
});

test("ogn-282-298 Monastery of Hirana: the buff is a non-target selection and the draw reads its result", () => {
  assert.equal(spendBuff.op, "effect.buff");
  assert.deepEqual(spendBuff.args.mode, { kind: "constant", value: "spend" });
  assert.deepEqual(spendBuff.args.target, { kind: "constant", value: "buff-holder" });
  // CR 355.10.c / 355.10.c.1: "spend a buff" is a cost inside the
  // instruction, so the buff is not a target; the unit carrying it is the
  // non-target selection and must be one the ability's controller controls
  // (CR 702.2.b.2).
  assert.equal(spendBuff.targets.length, 1);
  const [target] = spendBuff.targets;
  assert.equal(target.id, "buff-holder");
  assert.deepEqual(target.filter, { type: "unit", zone: "board", controller: "controller" });
  assert.equal(target.selection, "one");
  assert.equal(spendBuff.picks, undefined);

  // "… to draw 1": the draw is gated on the spend's own linked result, so it
  // cannot happen without a buff actually being spent.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition.kind, "compare");
  assert.equal(drawInstruction.condition.left.kind, "linked-value");
  assert.equal(drawInstruction.condition.left.instructionId, "monastery-of-hirana.spend-buff");
  assert.equal(drawInstruction.condition.left.key, "spentCount");
  assert.equal(drawInstruction.condition.operator, "gte");
  assert.deepEqual(drawInstruction.condition.right, { kind: "constant", value: 1 });
});

test("ogn-282-298 Monastery of Hirana: declining the optional keeps the buff and draws nothing", () => {
  const kernel = world().unit("buff-unit", { buffs: 1 }).deck(["top-card"]).build();
  kernel.setAnswers({ "monastery-of-hirana.opt-in/optional": false });
  const outcome = runAbilityBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(result => result.id), ["monastery-of-hirana.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("buff-unit").buffs, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.events, []);
});

test("ogn-282-298 Monastery of Hirana: accepting spends the buff through the real interpreter", () => {
  const kernel = world().unit("buff-unit", { buffs: 1 }).deck(["top-card", "bottom-card"]).build();
  kernel.setTargets("buff-holder", [kernel.ref("buff-unit")]);
  kernel.setAnswers({ "monastery-of-hirana.opt-in/optional": true });
  const outcome = runAbilityBody(spendOnlyBody, kernel);

  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["monastery-of-hirana.spend-buff", "executed"],
    ["monastery-of-hirana.opt-in", "executed"]
  ]);
  assert.equal(kernel.getObject("buff-unit").buffs, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["spend-buff"]);
});

test("ogn-282-298 Monastery of Hirana: a unit without a buff cannot be spent from, so nothing is drawn", () => {
  const kernel = world().unit("buff-unit", { buffs: 0 }).deck(["top-card"]).build();
  kernel.setTargets("buff-holder", [kernel.ref("buff-unit")]);
  kernel.setAnswers({ "monastery-of-hirana.opt-in/optional": true });
  const outcome = runAbilityBody(fullBody, kernel);

  // CR 702.2.b.1: a buff cannot be spent from a unit that does not have one.
  assert.equal(kernel.getObject("buff-unit").buffs, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.events, []);
  const spent = outcome.results.find(result => result.id === "monastery-of-hirana.spend-buff");
  assert.equal(spent.result.status, "negated");
  assert.equal(spent.result.reason, "skipped");
  // The draw's condition reads the spend's linked result, so with nothing spent
  // the instruction is skipped without dispatching anything (nothing drawn).
  const drew = outcome.results.find(result => result.id === "monastery-of-hirana.draw");
  assert.equal(drew.result.status, "negated");
  assert.equal(drew.result.reason, "skipped");
});

test("ogn-282-298 Monastery of Hirana: the spent-buff instruction alone performs the CR 702.2.b action", () => {
  const kernel = world().unit("buff-unit", { buffs: 2 }).build();
  const run = runInstruction(
    buff,
    // Direct primitive calls receive evaluated args (the interpreter evaluates
    // args before the schema), so mode is the plain string here.
    { mode: "spend", target: "buff-holder" },
    { world: kernel, targets: { "buff-holder": [kernel.ref("buff-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.spentCount, 1);
  assert.equal(run.linked.buffedCount, 0);
  assert.equal(kernel.getObject("buff-unit").buffs, 1);
  assert.deepEqual(run.events.map(event => event.action), ["spend-buff"]);
});

test("ogn-282-298 Monastery of Hirana: a replaced spend pays nothing and the gated draw draws nothing", () => {
  const kernel = world().unit("buff-unit", { buffs: 1 }).deck(["top-card"]).build();
  kernel.setTargets("buff-holder", [kernel.ref("buff-unit")]);
  kernel.setAnswers({ "monastery-of-hirana.opt-in/optional": true });
  // Contract 3.4: a replacement that prevents the action turns the instruction
  // into negated. The draw's condition reads the spend's linked result, so it
  // must not draw for a payment that never happened.
  kernel.addReplacement(action => (action.type === "spend-buff" ? "prevented" : null));
  const outcome = runAbilityBody(fullBody, kernel);

  assert.equal(kernel.getObject("buff-unit").buffs, 1);
  assert.equal(kernel.player("A").handSize, 0);
  const spent = outcome.results.find(result => result.id === "monastery-of-hirana.spend-buff");
  assert.equal(spent.result.status, "negated");
  assert.equal(spent.result.reason, "impossible");
  assert.equal(outcome.results.find(result => result.id === "monastery-of-hirana.draw").result.status, "ignored");
});

test("ogn-282-298 Monastery of Hirana: the draw instruction draws 1 for the ability's controller", () => {
  const kernel = world().deck(["top-card", "bottom-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});

test("ogn-282-298 Monastery of Hirana: accepting executes spend-then-draw through the chain adapter", () => {
  // The production card-body entry point (chain/engine.ts resolveChainBody) is
  // what runs a finalized ability's body; it also keeps the Expr envelope that
  // effect.draw's schema requires, so the whole printed instruction pair runs
  // in sequence here. Finalize-time target locking is supplied by the caller
  // (the golden drops the TargetSpec and hands the finalized set to the kernel,
  // see the header comment); the card's own ids, links and gating condition are
  // exercised unchanged.
  const kernel = world().unit("buff-unit", { buffs: 1 }).deck(["top-card", "bottom-card"]).build();
  kernel.setTargets("buff-holder", [kernel.ref("buff-unit")]);
  kernel.setAnswers({ "monastery-of-hirana.opt-in/optional": true });

  const outcome = resolveChainBody(fullBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["monastery-of-hirana.spend-buff", "executed"],
    ["monastery-of-hirana.draw", "executed"],
    ["monastery-of-hirana.opt-in", "executed"]
  ]);
  assert.equal(kernel.getObject("buff-unit").buffs, 0);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});

test.todo(
  "ogn-282-298 Monastery of Hirana: the buff payment as a Finalize-locked cost (CR 355.10.c.1/357) " +
    "so the player can decline even when a buff is available; TriggeredAbility has no cost field and " +
    "cost.pay's spend-buff instruction still lacks a TriggeredAbility Finalize adapter, so merged " +
    "effect.buff only reports 'skipped' after the fact"
);

test.todo(
  "ogn-282-298 Monastery of Hirana: bind the conquer trigger's `here` anchor to the scoring " +
    "payload details.battlefieldId (RIFT-357), so only a conquer at the hosted battlefield can " +
    "offer the spend-then-draw ability"
);

