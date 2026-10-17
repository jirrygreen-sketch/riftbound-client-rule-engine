import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadow-watcher.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

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
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /bindReplacement/);
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

test("unl-037-219 Shadow Watcher golden: the declared condition cannot see the printed Beginning-Phase death window", () => {
  // 315.2/315.2.a + 429.1: the clause is about deaths inside your Beginning
  // Phase this turn. The merged count expression only counts current objects
  // matching its declared filter, and the merged filter vocabulary has no
  // "died this turn in your Beginning Phase" dimension: the layer matcher
  // matches the friendly unit while the test kernel's set query finds nothing,
  // so the count neither reads deaths nor agrees across the merged readers.
  const friend = world().unit("friend", { owner: "A", might: 2 }).build();
  const environment = (kernel) => ({
    context: kernel,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  });
  assert.equal(matchesObjectFilter(enterReady.condition.left.filter, friend.getObject("friend")), true);
  assert.equal(evaluateCondition(enterReady.condition, environment(friend)), false);
  assert.equal(friend.query(enterReady.condition.left.filter).length, 0);
  // An empty board can never satisfy the printed clause either.
  assert.equal(evaluateCondition(enterReady.condition, environment(world().build())), false);
});

test("unl-037-219 Shadow Watcher golden: binding the card's ability intercepts the board entry and lands it ready (CR 359.2.c / 369.3)", () => {
  // The card's own ReplacementAbility goes through the merged bindReplacement:
  // the entering permanent is the replaced event's object, so the printed
  // orientation rewrite happens on the entry move instead of as a later ready.
  const kernel = world()
    .unit("shadow-watcher", { zone: "hand", types: ["unit"], exhausted: false })
    .build();
  const hostRef = kernel.ref("shadow-watcher");
  const registrations = [];
  const bound = bindReplacement(enterReady, hostRef, {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: {
      clock: { turn: 1 },
      registerReplacement: (registration) => registrations.push(registration)
    }
  });
  assert.equal(registrations.length, 1);

  // Playing the card moves it Hand -> Chain, which is where the entry
  // replacement takes over (CR 350.2 / 354); 143.4's default entry is exhausted.
  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const chainIncarnation = kernel.ref("shadow-watcher");
  assert.equal(kernel.perform({ type: "exhaust", object: chainIncarnation }).status, "done");
  assert.equal(kernel.getObject("shadow-watcher").exhausted, true);

  const entering = {
    type: "move-zone",
    object: chainIncarnation,
    to: "base",
    location: { type: "base", player: "A" }
  };
  // 369.3 / 370.1.b: an entry replacement only matches the declared exhausted entry.
  assert.equal(bound.registration.matches(entering, entering), true);
  const applied = bound.registration.apply(entering, entering);
  assert.equal(applied.status, "replace");
  assert.deepEqual(applied.actions.map((action) => action.type), ["ready", "move-zone"]);
  for (const action of applied.actions) assert.equal(kernel.perform(action).status, "done");
  const entered = kernel.getObject("shadow-watcher");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
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
    "change (CR 143.4/359.2.c/369.3) from the card program — bindReplacement consumes the ability above, " +
    "but nothing registers a card's ReplacementAbility in production (RIFT-257); a post-entry effect.ready " +
    "is not a substitute"
);
test.todo(
  "unl-037-219 Shadow Watcher: evaluate 'if a friendly unit died during your Beginning Phase this turn' " +
    "(CR 315.2/315.2.a/429.1) — the merged HistoryQuery scope only reaches turn/combat/game (no Beginning-Phase " +
    "window) and has no player-side death ledger; the count expression only counts current objects"
);
test.todo(
  "unl-037-219 Shadow Watcher: run the replacement body through the interpreter once the replacement is " +
    "registered — reference-kernel coverage of effect.ready already exists on sibling cards"
);
