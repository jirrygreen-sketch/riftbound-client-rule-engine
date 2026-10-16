import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/cloud-drake.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("cloud-drake: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play me, draw 1.");
});

test("cloud-drake: one mandatory card-played trigger scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("cloud-drake: body is one unlinked effect.draw of exactly 1", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "cloud-drake.draw");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("cloud-drake: the body draws through the chain adapter and the reference kernel", () => {
  const [ability] = program.abilities;
  const kernel = world().deck(["top", "next"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["cloud-drake.draw", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["cloud-drake.draw.drawn"], 1);
  assert.equal(outcome.linkedValues["cloud-drake.draw.drawnTo"], "A");
});

test("cloud-drake: an empty deck links the actual drawn count of 0 without inventing a card", () => {
  const [ability] = program.abilities;
  const kernel = world().build();
  const run = runInstruction(draw, ability.body[0].args, { world: kernel });
  // 414.4 / 契约 3.6：抽牌原语照实链接实际抽到的张数（Burn Out 由内核负责），
  // 空牌库不凭空产生牌，也不把请求量当结果。
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "cloud-drake: end-to-end card-played subscription, chain Pending/Finalize/Resolve and the " +
    "420.4.a play-effect ordering (CardProgram -> trigger/chain adapter, RIFT-120 follow-up)"
);
