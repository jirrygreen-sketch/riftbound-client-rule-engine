import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/cruel-patron.js";

test("ogn-208-298 Cruel Patron: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-ea1f0540f042966387899650fa2fbb3646f2d1d8ad7264dd83eb0fee4bd953de"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /cost kind|additional/);
  assert.equal(
    program.sourceText,
    "As an additional cost to play me, kill a friendly unit."
  );
});

test("ogn-208-298 Cruel Patron: a mandatory additional kill cost on the play ability with an empty body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "play");
  assert.equal(ability.restriction, undefined);
  assert.equal(ability.requirements, undefined);
  // The printed ability is a cost, not an effect: nothing resolves after the
  // card is played.
  assert.deepEqual(ability.body, []);

  // CR 356 / 355.10.c: the kill is an additional cost; its object selection is a
  // non-targeting cost choice (picks do not trigger "becomes a target").
  assert.equal(ability.cost.kind, "additional");
  assert.equal(ability.cost.payments.length, 1);
  const [payment] = ability.cost.payments;
  assert.equal(payment.kind, "kill");
  assert.equal(payment.choice.id, "friendly-unit");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.deepEqual(payment.choice.options, ["friendly-unit-on-board"]);
  // The filter keys describe the legal set ("a friendly unit"); contract 3.6
  // forbids runtime ObjectRefs in static IR, so the engine must expand the
  // option placeholder from these descriptors.
  assert.equal(payment.choice.type, "unit");
  assert.equal(payment.choice.zone, "board");
  assert.equal(payment.choice.controller, "controller");
});

test.todo(
  "ogn-208-298 Cruel Patron: pay the printed 4 energy plus the mandatory kill cost on a friendly unit " +
    "(CR 356/357.2, 203.3 rollback) — 已合入的 cost 计划器（RIFT-89）只接受 printed/activated/explicit 的 " +
    "CostSpec，卡牌程序没有把「印刷基础费用 + 强制附加费用」合并的字段，且 kill 支付需要按 filter 展开的运行时对象集合"
);
