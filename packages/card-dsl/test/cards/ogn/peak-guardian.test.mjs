import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/peak-guardian.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));

const SELF_ID = "peak-guardian.buff-me";
const OTHERS_ID = "peak-guardian.buff-others-here";

const bodyForExecution = () =>
  program.abilities[0].body.map(({ targets, ...rest }) => rest);

test("ogn-223-298 Peak Guardian: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-9280855113d398f4a348f702083fe564e2c7ef030983070eb28dcb3f83835e8d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /位置类型谓词/);
  assert.equal(
    program.sourceText,
    "When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there. " +
      "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)"
  );
});

test("ogn-223-298 Peak Guardian: card-played self trigger, buff-me, then the same-location peer buff", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 2);
  const [buffMe, buffOthers] = ability.body;
  assert.equal(buffMe.id, SELF_ID);
  assert.equal(buffMe.op, "effect.buff");
  assert.deepEqual(buffMe.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffMe.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buffMe.targets[0].filter, {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.equal(buffMe.linkedTo, undefined);

  // "buff all other friendly units there" is a programmatic selection over
  // characteristics (CR 355.10.d), not a target choice: all + other + friendly +
  // same location as the source (359.3.f.1 "there").
  assert.equal(buffOthers.id, OTHERS_ID);
  assert.equal(buffOthers.op, "effect.buff");
  assert.deepEqual(buffOthers.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffOthers.args.target, { kind: "constant", value: "other-friendlies-here" });
  assert.deepEqual(buffOthers.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    exclude: "self",
    sameLocationAs: "self"
  });
  assert.equal(buffOthers.targets[0].selection, "all");
  assert.equal(buffOthers.targets[0].min, 0);
  assert.equal(buffOthers.targets[0].max, null);
  // "Then, if I am at a battlefield" is a mandatory conditional clause: it is
  // NOT a player choice, so it must not be wrapped in choice.optional (that
  // would invent a decision), and an inexact condition placeholder must not be
  // authored either — the gate is the judged part (see judgeReason and the todo
  // below), so the instruction carries no condition at all.
  assert.equal(buffOthers.condition, undefined);
});

test("ogn-223-298 Peak Guardian golden: 'buff me' places one Buff, and a second Buff is not placed (CR 702.3.a)", () => {
  const fresh = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(fresh, "source", { value: fresh.getObject("peak-guardian") });
  fresh.setTargets("self-unit", [fresh.ref("peak-guardian")]);
  const freshOutcome = runAbilityBody(bodyForExecution().slice(0, 1), fresh);
  assert.equal(freshOutcome.results[0].result.status, "executed");
  assert.equal(fresh.getObject("peak-guardian").buffs, 1);

  const alreadyBuffed = world()
    .unit("peak-guardian", {
      might: 5,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  Object.defineProperty(alreadyBuffed, "source", { value: alreadyBuffed.getObject("peak-guardian") });
  alreadyBuffed.setTargets("self-unit", [alreadyBuffed.ref("peak-guardian")]);
  const repeatOutcome = runAbilityBody(bodyForExecution().slice(0, 1), alreadyBuffed);
  // 427.1.c / 702.3.a: a unit that already has a Buff is chosen but not Buffed.
  assert.equal(repeatOutcome.results[0].result.status, "negated");
  assert.equal(repeatOutcome.results[0].result.reason, "skipped");
  assert.equal(alreadyBuffed.getObject("peak-guardian").buffs, 1);
});

test("ogn-223-298 Peak Guardian golden: the peer buff hits every locked friendly unit at the same location", () => {
  const kernel = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-here", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-buffed", {
      might: 2,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .unit("ally-elsewhere", { might: 2, location: { type: "base", player: "A" } })
    .unit("enemy-here", { owner: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("peak-guardian") });
  kernel.setTargets(OTHERS_ID, []);
  kernel.setTargets("other-friendlies-here", [
    kernel.ref("ally-here"),
    kernel.ref("ally-buffed")
  ]);

  const [, buffOthers] = bodyForExecution();
  const outcome = runAbilityBody([buffOthers], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  // 702.3.a: only the un-Buffed peer gains the counter; the already-Buffed peer
  // is a legal choice that simply is not Buffed again.
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [
    { id: "ally-here", zoneEntryId: 1 }
  ]);
  assert.equal(kernel.getObject("ally-here").buffs, 1);
  assert.equal(kernel.getObject("ally-buffed").buffs, 1);
  assert.equal(kernel.getObject("ally-elsewhere").buffs, 0);
  assert.equal(kernel.getObject("enemy-here").buffs, 0);
});

test("ogn-223-298 Peak Guardian: peers that left the same location before resolution are ignored (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("peak-guardian", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-here", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("peak-guardian") });
  const stale = kernel.ref("ally-here");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("other-friendlies-here", [stale]);

  const [, buffOthers] = bodyForExecution();
  const outcome = runAbilityBody([buffOthers], kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "ogn-223-298 Peak Guardian: 'if I am at a battlefield' as a decidable condition — " +
    "需要“来源当前位置的类型是 battlefield”的谓词才能在结算时门控 body[1]：Condition 现有操作符无法表达" +
    "嵌套的 location.type（expression 对 location 对象只做布尔转换、恒为真），程序里因此不写语义不等价的占位条件；" +
    "门控缺失时本卡在基地结算会多作用于基地上的其它友方单位"
);
