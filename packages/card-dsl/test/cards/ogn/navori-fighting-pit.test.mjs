import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/navori-fighting-pit.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-546a7aea49dffb7a5d50977e6011ab55e4c623b1ff68083db798c52197395627";
const HERE = { type: "battlefield", id: "battlefield-1" };
const ELSEWHERE = { type: "battlefield", id: "battlefield-2" };
const [ability] = program.abilities;

test("ogn-283-298 Navori Fighting Pit: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The gap must name the real cause: the hold timing point has no producer in
  // merged code (not a generic "not implemented yet").
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /RIFT-31/);
  assert.match(program.judgeReason, /RIFT-33/);
  assert.equal(
    program.sourceText,
    "When you hold here, buff a unit here. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
});

test("ogn-283-298: hold trigger with a here anchor and a buff body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [buff] = ability.body;
  assert.equal(buff.id, "navori.buff-unit-here");
  assert.equal(buff.op, "effect.buff");
  assert.equal(buff.linkedTo, undefined);
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: "navori.unit-here" });

  // "a unit here" is one chosen unit at the source Battlefield: a TargetSpec
  // (355.5/355.7) whose filter anchors the location to the ability host.
  assert.equal(buff.targets.length, 1);
  const [spec] = buff.targets;
  assert.equal(spec.id, "navori.unit-here");
  assert.deepEqual(spec.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("ogn-283-298: buffs only the locked unit at the source Battlefield", () => {
  // The reference kernel compares filter values literally, so the Finalize
  // target set is supplied directly (ogn/pit-rookie.test.mjs precedent); the
  // sameLocationAs anchor itself is resolved by the interpreter against the
  // host reference passed in the options.
  const kernel = world()
    .unit("pit", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { location: HERE, might: 2 })
    .unit("there-enemy", { owner: "B", location: ELSEWHERE, might: 2 })
    .build();
  const host = kernel.ref("pit");

  // A unit at the source Battlefield is a legal target and is buffed once.
  const legal = kernel.clone({ sourceSnapshot: kernel.getObject("pit") });
  legal.setTargets("navori.unit-here", [legal.ref("here-ally")]);
  const ran = runAbilityBody(ability.body, legal, undefined, { host });
  assert.equal(ran.results[0].result.status, "executed");
  assert.equal(ran.results[0].result.linkedValues.buffedCount, 1);
  assert.deepEqual(ran.events.map(event => event.action), ["buff"]);
  assert.equal(legal.getObject("here-ally").buffs, 1);
  assert.equal(legal.getObject("there-enemy").buffs, 0);

  // A locked target outside the source Battlefield is excluded by the "here"
  // anchor: the instruction is ignored as mistargeted and nothing changes.
  const illegal = kernel.clone({ sourceSnapshot: kernel.getObject("pit") });
  illegal.setTargets("navori.unit-here", [illegal.ref("there-enemy")]);
  const rejected = runAbilityBody(ability.body, illegal, undefined, { host });
  assert.equal(rejected.results[0].result.status, "ignored");
  assert.equal(rejected.results[0].result.reason, "mistargeted");
  assert.deepEqual(rejected.events, []);
  assert.equal(illegal.getObject("there-enemy").buffs, 0);
});

test("ogn-283-298: a unit that already has a buff is not buffed again (CR 702.3.a)", () => {
  const kernel = world()
    .unit("pit", { types: ["battlefield"], location: HERE })
    .unit("buffed-ally", { location: HERE, buffs: 1 })
    .build();
  kernel.setTargets("navori.unit-here", [kernel.ref("buffed-ally")]);
  const ran = runAbilityBody(ability.body, kernel, undefined, { host: kernel.ref("pit") });
  assert.equal(ran.results[0].result.status, "negated");
  assert.equal(ran.results[0].result.reason, "skipped");
  assert.deepEqual(ran.events, []);
  assert.equal(kernel.getObject("buffed-ally").buffs, 1);
});

test("ogn-283-298: the trigger filter still carries the unreplaced here placeholder", () => {
  // Evidence for the judgeReason: the engine rejects the placeholder key, so
  // the ability cannot yet run through the real trigger pipeline.
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test.todo(
  "ogn-283-298: the hold timing point is emitted by scoring, enters the chain and the " +
    "trigger resolves (依赖 RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers；" +
    "契约 §7.2 批 5 的 scoring/触发接线)"
);
test.todo(
  "ogn-283-298: 703 layer arithmetic turns the placed Buff into +1 effective Might " +
    "(依赖 RIFT-91 layers-continuous 的 buffs → Might 结算)"
);
