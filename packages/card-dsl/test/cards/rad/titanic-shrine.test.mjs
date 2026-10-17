import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/titanic-shrine.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;

const CARD_ID = "card.hash-4647932ee2d6158c5f7a09247a187cb76e06c69e293aea63f24b3d7ee7dc2a7c";
const EXPECTED_SOURCE =
  "When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1.";

test("rad-089-167 Titanic Shrine: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /paymentsPlan/);
  assert.match(program.judgeReason, /exhaust ObjectRef/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /Might/);
});

test("rad-089-167 Titanic Shrine: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-089-167 Titanic Shrine: card-played trigger for a played unit, draw-only body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { type: "unit", player: "self" }
  });
  // 条件谓词不可表达（judgeReason 第 2 点）：不写条件，也不写成恒真条件。
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);

  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["titanic-shrine.draw-1", "effect.draw"]
  ]);
  const [drawInstruction] = ability.body;
  // "exhaust me" 是触发能力的费用（TriggeredAbility 没有 cost 字段，judgeReason 第 1 点）；
  // 静态 IR 在 card-played 时点给不出该 exhaust ObjectRef，因此不写 effect.exhaust 近似。
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-089-167 Titanic Shrine: the Draw 1 half executes against the reference kernel", () => {
  const drawInstruction = program.abilities[0].body[0];
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo("rad-089-167 Titanic Shrine: paying \"exhaust me\" as a cost (CR 204.1.c / 204.3 / 355.10.c.1) needs a TriggeredAbility cost field; the merged cost.pay plan cannot encode the event-time exhaust ObjectRef and no trigger-side cost-plan consumer exists. The exhaust must not be approximated with effect.exhaust.");
test.todo("rad-089-167 Titanic Shrine: the condition \"Might greater than each other unit on the board\" needs the played unit bound from the card-played payload (no event-object ObjectSelector exists) plus a numerical Might comparison against every other board unit; the predicate itself belongs to the in-flight RIFT-359 conditional work.");
