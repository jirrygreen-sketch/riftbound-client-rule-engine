import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lingering-animus.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ENTER_READY = "lingering-animus.enter-ready";

test("rad-005-167 Lingering Animus: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "I enter ready if a friendly unit or gear died this turn.");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /HistoryQuery/);
});

test("rad-005-167: board-entry replacement gated on this-turn friendly death history", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(ability.condition.kind, "compare");
  // 条件主题是审查用占位：解释器/历史系统需把“本回合死亡的友方单位或装备”计数绑定到该 subject。
  assert.deepEqual(ability.condition.left, {
    kind: "count",
    subject: "friendly-unit-or-gear-died-this-turn",
    filter: { zone: "history-record" }
  });
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
  assert.equal(ability.with.length, 1);
  assert.equal(ability.with[0].id, ENTER_READY);
  assert.equal(ability.with[0].op, "effect.ready");
  assert.deepEqual(ability.with[0].args, {});
});

test("rad-005-167: the replacement body readies the exhausted source through real effect.ready", () => {
  // 用参考内核真实执行 replacement 的 with 体（effect.ready 已合入），验证“就绪”这一半的语义。
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: true }).build();
  assert.equal(kernel.getObject("lingering-animus").exhausted, true);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => entry.id), [ENTER_READY]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("lingering-animus").exhausted, false);
});

test("rad-005-167: a ready source makes the body a no-op executed result (416.1.b)", () => {
  const kernel = world().unit("lingering-animus", { might: 2, exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lingering-animus") });

  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(scoped.events, []);
});

test.todo(
  "rad-005-167 Lingering Animus: 入场替代（replacement.enter，369.3 把“横置进场”改为“就绪进场”）" +
    "依赖 RIFT-83/RIFT-84；effect.ready 不能事后模拟入场状态"
);
test.todo(
  "rad-005-167 Lingering Animus: “a friendly unit or gear died this turn” 的历史条件依赖" +
    "condition.history / HistoryQuery 的按对象与类型过滤扩展（RIFT-89/90）"
);
