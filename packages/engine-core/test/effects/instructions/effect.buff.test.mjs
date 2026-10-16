import assert from "node:assert/strict";
import test from "node:test";

import buff from "../../../dist/effects/instructions/effect.buff.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const TARGET = "t1";

const literal = value => ({ kind: "literal", value });

const buffArgs = (extra = {}) => ({ mode: "buff", target: TARGET, ...extra });
const spendArgs = (extra = {}) => ({ mode: "spend", target: TARGET, ...extra });

const buffs = (kernel, id) => kernel.getObject(id).buffs;
const refsOf = (kernel, run, key) => (run.linked[key] ?? []).map(entry => kernel.ref(entry.id));

test("buff adds a Buff counter to each targeted unit (ogn-136-298 Pit Rookie: buff another friendly unit)", () => {
  const kernel = world().unit("ally").unit("enemy", { owner: "B" }).build();
  const run = runInstruction(buff, buffArgs(), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("ally"), kernel.ref("enemy")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(buffs(kernel, "ally"), 1);
  assert.equal(buffs(kernel, "enemy"), 1);
  assert.deepEqual(run.linked.buffedCount, 2);
  assert.deepEqual(run.linked.spentCount, 0);
  assert.equal(run.events.every(event => event.action === "buff"), true);
});

test("a replacement hook on the buff action negates the instruction", () => {
  const kernel = world().unit("u1").build();
  kernel.addReplacement(action => (action.type === "buff" ? "replaced" : null));
  const run = runInstruction(buff, buffArgs(), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(buffs(kernel, "u1"), 0);
});

test("a target that left its zone (stale zoneEntryId) makes the instruction ignored", () => {
  const kernel = world().unit("u1").build();
  const stale = kernel.ref("u1");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(buff, buffArgs(), {
    world: kernel,
    targets: { [TARGET]: [stale] }
  });
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(run.events.length, 0);
});

test("amount 0 performs no action and is negated as skipped, with empty links", () => {
  const kernel = world().unit("u1").build();
  const run = runInstruction(buff, buffArgs({ amount: literal(0) }), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(buffs(kernel, "u1"), 0);
  assert.deepEqual(run.linked.buffedCount, 0);
  assert.deepEqual(run.linked.buffed, []);
});

test("spend removes at most the counters a unit actually has (CR 702.2.b.1)", () => {
  const kernel = world().unit("u1", { buffs: 1 }).build();
  const run = runInstruction(buff, spendArgs({ amount: literal(5) }), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(buffs(kernel, "u1"), 0);
  assert.deepEqual(run.linked.spentCount, 1);
});

test("chooseUpTo suspends without an answer, leaves the world untouched, then commits on replay (ogn-141-298 Kinkou Monk: buff up to two other friendly units)", () => {
  const kernel = world().unit("a").unit("b").build();
  const options = () => [kernel.ref("a"), kernel.ref("b")];
  const ask = runInstruction(buff, buffArgs({ chooseUpTo: true }), {
    world: kernel,
    targets: { [TARGET]: options() }
  });
  assert.ok(ask.asked instanceof AwaitChoice);
  assert.equal(ask.asked.request.id, TARGET + ":buff-targets");
  assert.equal(ask.asked.request.type, "select-objects");
  assert.equal(ask.asked.request.min, 0);
  assert.equal(ask.asked.request.max, 2);
  assert.equal(buffs(kernel, "a"), 0);
  assert.equal(buffs(kernel, "b"), 0);
  const answered = runInstruction(buff, buffArgs({ chooseUpTo: true }), {
    world: kernel,
    targets: { [TARGET]: options() },
    answers: { [TARGET + ":buff-targets"]: [kernel.ref("a")] }
  });
  assert.equal(answered.result.status, "executed");
  assert.equal(buffs(kernel, "a"), 1);
  assert.equal(buffs(kernel, "b"), 0);
  assert.deepEqual(answered.linked.buffedCount, 1);
});

test("a unit that is already buffed is skipped (CR 702.3.a) while the other target is buffed (ogn-063-298 Spirit's Refuge: buff a friendly unit)", () => {
  const kernel = world().unit("ready").unit("charged", { buffs: 1 }).build();
  const run = runInstruction(buff, buffArgs(), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("ready"), kernel.ref("charged")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(buffs(kernel, "ready"), 1);
  assert.equal(buffs(kernel, "charged"), 1);
  assert.deepEqual(refsOf(kernel, run, "buffed").map(ref => ref.id), ["ready"]);
});

test("when every candidate is already buffed the instruction is negated as skipped (CR 427.1.c)", () => {
  const kernel = world().unit("u1", { buffs: 1 }).build();
  const run = runInstruction(buff, buffArgs(), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(buffs(kernel, "u1"), 1);
});

test("spending ignores units the spender does not control (CR 702.2.b.2)", () => {
  const kernel = world().unit("mine", { buffs: 1 }).unit("theirs", { owner: "B", buffs: 1 }).build();
  const run = runInstruction(buff, spendArgs(), {
    world: kernel,
    targets: { [TARGET]: [kernel.ref("mine"), kernel.ref("theirs")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(buffs(kernel, "mine"), 0);
  assert.equal(buffs(kernel, "theirs"), 1);
  assert.deepEqual(run.linked.spentCount, 1);
});

test("spend and re-buff move the counter down and back up through the linked values", () => {
  const kernel = world().unit("u1", { buffs: 1 }).build();
  const targets = () => ({ [TARGET]: [kernel.ref("u1")] });
  const spent = runInstruction(buff, spendArgs(), { world: kernel, targets: targets() });
  assert.equal(spent.result.status, "executed");
  assert.equal(buffs(kernel, "u1"), 0);
  assert.deepEqual(spent.linked.spentCount, 1);
  const rebuffed = runInstruction(buff, buffArgs(), { world: kernel, targets: targets() });
  assert.equal(rebuffed.result.status, "executed");
  assert.equal(buffs(kernel, "u1"), 1);
  assert.deepEqual(rebuffed.linked.buffedCount, 1);
});

test("argsSchema rejects malformed args without touching the world", () => {
  const kernel = world().unit("u1").build();
  assert.throws(() => runInstruction(buff, { mode: "buff" }, { world: kernel }), /target/);
  assert.throws(() => runInstruction(buff, { mode: "buff", target: "t1", amount: 3 }, { world: kernel }), /Expr/);
  assert.equal(buffs(kernel, "u1"), 0);
});
