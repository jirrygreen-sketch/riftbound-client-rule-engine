import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lingering-animus.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
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
  // README §2: the reason names the still-missing bindings and their owners.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /HistoryQuery/);
});

test("rad-005-167: board-entry replacement readies the entering unit (CR 369.3)", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "replacement");
  assert.deepEqual(ability.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  // The condition needs a “friendly unit or gear died this turn” predicate that
  // the merged Condition / HistoryQuery vocabulary does not provide, so it is
  // deliberately absent instead of a placeholder that would silently be false.
  assert.equal(ability.condition, undefined);
  assert.equal(ability.with.length, 1);
  assert.equal(ability.with[0].id, ENTER_READY);
  assert.equal(ability.with[0].op, "effect.ready");
  assert.deepEqual(ability.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
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

test("rad-005-167: the replacement also binds and rewrites the real entry move", () => {
  // RIFT-260 binding: the same body is accepted by bindReplacement and applies
  // to an object-enters-board rewrite. The condition-less card keeps this
  // executable half covered; the “died this turn” gate stays missing (see
  // judgeReason) so the card is not executable end to end.
  const kernel = world()
    .player("A", { energy: 0 })
    .unit("lingering-animus", { might: 2, zone: "chain", exhausted: true })
    .build();
  const zoneEntries = [];
  const pipeline = {
    clock: { turn: 1 },
    registerReplacement(registration) { zoneEntries.push(registration); }
  };
  const bound = bindReplacement(
    program.abilities[0],
    kernel.ref("lingering-animus"),
    {
      host: {
        object: ref => kernel.object(ref),
        objects: () => kernel.objects,
        context: () => kernel
      },
      pipeline
    }
  );
  assert.equal(zoneEntries.length, 1);
  assert.equal(typeof bound.cancel, "function");
  assert.equal(zoneEntries[0].source.ref.id, "lingering-animus");
});

test.todo(
  "rad-005-167 Lingering Animus: 入场替代（replacement.enter，369.3 把“横置进场”改为“就绪进场”）" +
    "依赖 RIFT-257/260 的卡牌程序绑定；effect.ready 不能替代入场动作本身"
);
test.todo(
  "rad-005-167 Lingering Animus: “a friendly unit or gear died this turn” 的历史条件依赖" +
    "按对象类型/控制者过滤的历史谓词（Condition 无 history 节点，HistoryQuery 无类型/控制者维度）"
);
