import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadow-watcher.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-914ae0a53b785c0cddd76d977413c9c36d1bc8a2bd78e0f3a1d68a71ae5f718e";
const SOURCE_TEXT =
  "If a friendly unit died during your Beginning Phase this turn, I enter ready.";

const [enterReady] = program.abilities;
const [readySource] = enterReady.with;

test("unl-037-219 Shadow Watcher: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-037-219 Shadow Watcher: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /315\.2/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-037-219 Shadow Watcher: 'I enter ready' is a board-entry replacement, never a later ready", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(enterReady.kind, "replacement");
  // 143.4 / 359.2.c：单位默认横置入场；369.3 的 Master Yi, Honed 示例把 “I enter ready.” 明确列为
  // 入场替代（替换“横置入场”这件事本身）。
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(enterReady.with.map((instruction) => [instruction.id, instruction.op]), [
    ["shadow-watcher.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(enterReady.with[0].targets, undefined);
  assert.equal(enterReady.linkedTo, undefined);
});

test("unl-037-219 Shadow Watcher: the 'died in your Beginning Phase this turn' clause is the replacement condition", () => {
  const condition = enterReady.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  // 保留形状：被查询的 subject 名称记录了真实的窗口语义（本回合 + 你的 Beginning Phase），
  // 因为它无法用冻结的 HistoryQuery 表达（见 judgeReason）。
  assert.equal(condition.left.subject, "friendly-units-died-during-your-beginning-phase-this-turn");
  // “friendly unit” = 由你控制的单位（740.1.a）。
  assert.deepEqual(condition.left.filter, { type: "unit", controller: "self" });
});

// The replacement consumer itself is unmerged (see judgeReason), so the golden
// executes the declared with-body against a real exhausted board unit: the
// entering unit is the replaced event's object and therefore the bound source/host.
test("unl-037-219 Shadow Watcher golden: the replacement body readies the entering exhausted source", () => {
  const base = world().unit("shadow-watcher", { zone: "board", exhausted: true, might: 5 }).build();
  const ctx = base.clone({
    source: base.ref("shadow-watcher"),
    sourceSnapshot: base.getObject("shadow-watcher")
  });
  assert.equal(ctx.getObject("shadow-watcher").exhausted, true);

  const outcome = resolveChainBody([readySource], ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["shadow-watcher.enter-ready", "executed"]
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
  assert.equal(ctx.getObject("shadow-watcher").exhausted, false);
  // 416.1.b/416.1.c：已经就绪的单位不会再被重置，也不补发事件。
  const alreadyReady = world().unit("shadow-watcher", { zone: "board", exhausted: false }).build();
  const readyCtx = alreadyReady.clone({
    source: alreadyReady.ref("shadow-watcher"),
    sourceSnapshot: alreadyReady.getObject("shadow-watcher")
  });
  const noop = resolveChainBody([readySource], readyCtx);
  assert.equal(noop.results[0].result.status, "executed");
  assert.deepEqual(noop.results[0].result.linkedValues.readied, { count: 0, objects: [] });
  assert.deepEqual(readyCtx.events, []);
});

test.todo(
  "unl-037-219 Shadow Watcher: register the 'I enter ready' board-entry replacement before the zone " +
    "change (CR 143.4/359.2.c/369.3) — no card ReplacementAbility consumer is merged (RIFT-9/RIFT-120); " +
    "a post-entry effect.ready is not a substitute"
);
test.todo(
  "unl-037-219 Shadow Watcher: evaluate 'if a friendly unit died during your Beginning Phase this turn' " +
    "(CR 315.2/315.2.a/429.1) — the frozen HistoryQuery has no phase-range window nor a player death ledger " +
    "(count only counts current objects)"
);
test.todo(
  "unl-037-219 Shadow Watcher: run the replacement body through the interpreter once the replacement is " +
    "registered — reference-kernel coverage of effect.ready already exists on sibling cards"
);
