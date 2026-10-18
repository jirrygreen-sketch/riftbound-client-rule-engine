import assert from "node:assert/strict";
import test from "node:test";

import deathknell from "../../dist/effects/keywords/Deathknell.js";
import leave from "../../dist/effects/instructions/trigger.leave.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";
import { fixture, resolveAll } from "../chain/helpers.mjs";

const c = value => ({ kind: "constant", value });
const HOST = "test:eg-leave";

function killedContext() {
  const kernel = world()
    .unit("victim", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("victim");
  const ref = kernel.ref("victim");
  assert.equal(kernel.perform({ type: "kill", object: ref }).status, "done");
  return { kernel, source, ref };
}

test("EG-LEAVE registers an executable boundary and keeps Deathknell's subscription separate", () => {
  assert.ok(instructionDefinitionsById.has("trigger.leave"));
  const [ability] = deathknell.expand({ host: { canonicalCardId: HOST } });
  assert.equal(ability.kind, "triggered");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.deepEqual(ability.body.map(instruction => instruction.op), ["trigger.leave"]);
  assert.deepEqual(ability.body[0].args, { cause: c("kill") });
});

test("EG-LEAVE succeeds only after a real kill and publishes source LKI links", () => {
  const { kernel, source } = killedContext();
  const context = kernel.clone({ sourceSnapshot: source, timingPoint: "object-killed" });
  const run = runInstruction(leave, { cause: c("kill") }, { world: context });

  assert.deepEqual(run.result, { status: "executed", events: [], linkedValues: run.result.linkedValues });
  assert.deepEqual(run.linked.leave, source.ref);
  assert.equal(run.linked.leaveCause, "kill");
  assert.equal(run.linked.leaveDestination, "trash");
  assert.equal(run.linked.left, true);
  assert.equal(run.linked.leaveSource.zone, "board");
  assert.deepEqual(run.linked.leaveSource.ref, source.ref);
  assert.equal(context.getObject("victim").zone, "trash");
});

test("EG-LEAVE rejects an unsupported cause without mutating the world", () => {
  const { kernel, source } = killedContext();
  const context = kernel.clone({ sourceSnapshot: source, timingPoint: "object-killed" });
  const before = context.stateForTest();
  const run = runInstruction(leave, { cause: c("recall") }, { world: context });

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(context.stateForTest(), before);
  assert.deepEqual(run.linked, {});
});

test("EG-LEAVE ignores a source that has not left or has become stale", () => {
  const live = world().unit("victim", { location: { type: "battlefield", id: "bf-1" } }).build();
  const liveRun = runInstruction(leave, { cause: c("kill") }, {
    world: live.clone({ sourceSnapshot: live.getObject("victim"), timingPoint: "object-killed" })
  });
  assert.deepEqual(liveRun.result, { status: "ignored", reason: "mistargeted" });

  const { kernel, source } = killedContext();
  const replacement = kernel.clone({ sourceSnapshot: source, timingPoint: "object-killed" });
  assert.equal(replacement.perform({
    type: "move-zone", object: replacement.ref("victim"), to: "hand"
  }).status, "done");
  const stale = runInstruction(leave, { cause: c("kill") }, { world: replacement });
  assert.deepEqual(stale.result, { status: "ignored", reason: "mistargeted" });
});

test("EG-LEAVE's payload runs through one real Pending Deathknell item", () => {
  const body = [{ id: "deathknell.draw", op: "effect.draw", args: { amount: c(1) } }];
  const [ability] = deathknell.expand({ host: { canonicalCardId: HOST }, params: { body } });
  assert.deepEqual(ability.body.map(instruction => instruction.op), ["trigger.leave", "effect.draw"]);

  const f = fixture();
  f.engine.pipeline.registerTrigger({
    id: "deathknell:source",
    source: f.kernel.getObject("source"),
    controller: "A",
    spec: { at: "object-killed", filter: { objectId: "source" } },
    body: ability.body
  });
  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("source") });
  assert.equal(outcome.status, "done");
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].kind, "triggered");
  assert.equal(f.engine.items[0].source.zone, "board");
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, 1);
  assert.equal(f.kernel.getObject("source").zone, "trash");
});

test("EG-LEAVE sees a replaced kill as no death trigger and preserves rollback", () => {
  const f = fixture();
  f.engine.pipeline.registerTrigger({
    id: "deathknell:source",
    source: f.kernel.getObject("source"),
    controller: "A",
    spec: { at: "object-killed", filter: { objectId: "source" } },
    body: [{ id: "leave", op: "trigger.leave", args: { cause: c("kill") } }]
  });
  f.engine.pipeline.registerReplacement({
    id: "replace-kill",
    matches: action => action.type === "kill" && action.object.id === "source",
    apply: action => ({ status: "replace", actions: [{ type: "move-location", object: action.object, to: { type: "base", player: "A" } }] })
  });
  const before = f.kernel.stateForTest();
  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("source") });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-killed"), false);
  assert.equal(f.kernel.getObject("source").zone, "board");
  assert.deepEqual(f.kernel.getObject("source").location, { type: "base", player: "A" });
  assert.notDeepEqual(f.kernel.stateForTest(), before);

  const rollback = fixture();
  rollback.engine.pipeline.registerTrigger({
    id: "optional-deathknell",
    source: rollback.kernel.getObject("source"),
    controller: "A",
    optional: true,
    spec: { at: "object-killed", filter: { objectId: "source" } },
    body: [{ id: "leave", op: "trigger.leave", args: { cause: c("kill") } }]
  });
  const rollbackBefore = rollback.kernel.stateForTest();
  assert.throws(() => rollback.engine.commit({ type: "kill", object: rollback.kernel.ref("source") }), error => {
    assert.ok(error instanceof AwaitChoice);
    return true;
  });
  assert.deepEqual(rollback.kernel.stateForTest(), rollbackBefore);
  assert.equal(rollback.engine.items.length, 0);
  assert.equal(rollback.engine.pipeline.events.length, 0);
});
