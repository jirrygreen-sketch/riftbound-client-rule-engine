import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/titanic-shrine.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
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
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Might/);
});

test("rad-089-167 Titanic Shrine: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-089-167 Titanic Shrine: card-played trigger for a played unit, cost-then-draw body", () => {
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
    ["titanic-shrine.pay-exhaust", "cost.pay"],
    ["titanic-shrine.draw-1", "effect.draw"]
  ]);
  const [pay, drawInstruction] = ability.body;
  // 204.3：成本内指令的横置不是 effect.exhaust。
  assert.deepEqual(pay.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(pay.targets, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-089-167 Titanic Shrine: the pending cost.pay clause fails loudly", () => {
  // 守卫：不能用 no-op 或假费用顶替成本内指令；未合入原语必须显式失败。
  const kernel = world().unit("titanic-shrine", { types: ["gear"], might: null }).build();
  const ability = program.abilities[0];
  assert.throws(
    () => runAbilityBody(ability.body, kernel),
    /Unregistered instruction opcode: cost\.pay/
  );
  assert.equal(kernel.getObject("titanic-shrine").exhausted, false);
  assert.deepEqual(kernel.events, []);
});

test("rad-089-167 Titanic Shrine: the Draw 1 half executes against the reference kernel", () => {
  const drawInstruction = program.abilities[0].body[1];
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
});

test.todo("rad-089-167 Titanic Shrine: paying \"exhaust me\" as a cost within instructions (CR 204.1.c / 204.3 / 355.10.c.1) needs a merged cost.pay instruction and the Finalize cost pipeline (RIFT-89 follow-up); the exhaust must not be approximated with effect.exhaust.");
test.todo("rad-089-167 Titanic Shrine: the condition \"Might greater than each other unit on the board\" needs the played unit bound from the card-played payload (no event-object ObjectSelector exists) plus a numerical Might comparison against every other board unit.");
test.todo("rad-089-167 Titanic Shrine: the program -> TriggerRegistration wiring (contract 3.5) is required before the trigger can fire at all.");
