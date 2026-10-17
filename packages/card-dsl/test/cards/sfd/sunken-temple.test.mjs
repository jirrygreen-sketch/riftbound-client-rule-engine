import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import effectDraw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

test("sunken-temple: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("sunken-temple: conquer-with-Mighty structure with pay and draw", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Mighty/);
  assert.match(program.judgeReason, /Might 阈值/);
  assert.match(program.judgeReason, /Might/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.match(program.judgeReason, /conquering-units/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  // "conquered" is the closed event-vocabulary discriminant; EVENT_NAMES maps
  // it onto the conquer timing point.
  assert.equal(ability.trigger.filter.event, "conquered");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.optional, true);
  // The Might>=5 gate is a trigger condition (CR v1.5 706–709).
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.filter.mightGte, 5);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["sunken-temple.opt-in"]);
  const [choice] = ability.body;
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  const [pay, draw] = choice.args.body.value;
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), ["sunken-temple.pay", "sunken-temple.draw"]);
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, undefined);
  assert.deepEqual(pay.args.payments, { kind: "constant", value: { energy: 1 } });
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.linkedTo, "sunken-temple.pay");
});

test("sunken-temple: declining skips both payment and draw", () => {
  const kernel = world().deck("top-card").build();
  kernel.setAnswers({ "sunken-temple.opt-in/optional": false });
  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["sunken-temple.opt-in"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.zone("A", "deck").length, 1);
  assert.equal(kernel.zone("A", "hand").length, 0);
});

test("sunken-temple: accepting the optional choice pays then draws through the production adapter", () => {
  const kernel = world().player("A", { energy: 2 }).deck("top-card").build();
  kernel.setAnswers({ "sunken-temple.opt-in/optional": true });
  const outcome = resolveChainBody(program.abilities[0].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(kernel.events.map((event) => event.action), ["pay", "draw"]);
});

test("sunken-temple: the merged cost.pay primitive executes the optional one-energy payment", () => {
  const kernel = world().player("A", { energy: 2 }).deck("top-card").build();
  const [choice] = program.abilities[0].body;
  const [pay] = choice.args.body.value;
  const outcome = runAbilityBody([pay], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(kernel.events.at(-1).action, "pay");
});

test("sunken-temple: the merged draw primitive executes the printed draw-1 for real", () => {
  // The card's own draw args (amount 1) are executed through the merged
  // effect.draw primitive; the trigger condition remains the only unresolved
  // card-level selection path.
  const kernel = world().deck("top-card").build();
  const [choice] = program.abilities[0].body;
  const [, drawInstruction] = choice.args.body.value;
  const run = runInstruction(effectDraw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.zone("A", "hand").length, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.equal(drawInstruction.linkedTo, "sunken-temple.pay");
});

test.todo(
  "sunken-temple: production trigger matching must bind conquer's battlefieldId to the card's here anchor and count only " +
    "the conquering Mighty units; the declared payload and Might thresholds still need those runtime selectors"
);

test("sunken-temple: the printed here anchor is rejected by the production trigger translator", () => {
  // Live evidence for judgeReason (1): `here` is not a supported EventPattern
  // field, so the merged binding path cannot register the trigger at all.
  const [ability] = program.abilities;
  assert.equal(ability.trigger.filter.here, true);
  assert.throws(
    () => translateTriggerFilter(ability.trigger.filter, "sunken-temple", ability.trigger.at),
    /Unsupported filter field here/
  );
});

test("sunken-temple: neither the count subject nor a Might threshold can select the conquering Mighty units", () => {
  // Live evidence for judgeReason (2): the merged count expression reads only its
  // filter (the subject name is decorative here), and the layer matcher ignores
  // an unknown Might-threshold key, so a 1-Might unit would be counted as Mighty.
  const kernel = world()
    .unit("mighty-unit", { controller: "A", might: 6 })
    .unit("weak-unit", { controller: "A", might: 1 })
    .build();

  assert.equal(kernel.evaluate({ kind: "count", subject: "conquering-units", filter: { type: "unit" } }), 2);
  assert.equal(kernel.evaluate({ kind: "count", subject: "conquering-units", filter: { type: "unit", mightGte: 5 } }), 2);
  assert.equal(matchesObjectFilter({ type: "unit", mightGte: 5 }, kernel.getObject("weak-unit")), true);
  assert.equal(matchesObjectFilter({ type: "unit", characteristics: { might: 5 } }, kernel.getObject("mighty-unit")), false);
});
