import assert from "node:assert/strict";
import test from "node:test";
import { TestWorld, runInstruction, world } from "../../../dist/effects/testing/index.js";
import definition from "../../../dist/effects/instructions/effect.kill.js";

/** 快捷构造：一张在场上某战场的单位。 */
function unitAtBattlefield(id, owner = "A", battlefieldId = "battlefield-1") {
  return { owner, zone: "board", location: { type: "battlefield", id: battlefieldId } };
}

test("ogn-229-298 Vengeance: Kill a unit — target mode kills the chosen enemy unit", () => {
  const testWorld = world()
    .unit("vengeance-source", { owner: "A", zone: "chain" })
    .unit("enemy-unit", unitAtBattlefield("enemy-unit", "B"))
    .build();
  const target = testWorld.ref("enemy-unit");
  const run = runInstruction(definition, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [target] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("enemy-unit")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [target]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "kill");
});

test("unl-136-219 Scryer's Bloom: Kill this (activated ability cost) — self mode kills the source gear", () => {
  const base = world()
    .object("scryers-bloom", { owner: "A", zone: "board", types: ["gear"], location: { type: "base", player: "A" } })
    .build();
  const sourceRef = base.ref("scryers-bloom");
  const testWorld = new TestWorld({ state: base.snapshot(), source: sourceRef });
  const run = runInstruction(definition, { self: true, reason: "activated-cost" }, {
    world: testWorld
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("scryers-bloom")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [sourceRef]);
});

test("unl-159-219 Soul Harvest: Kill a unit at a battlefield with 3 Might or less — target on board", () => {
  const testWorld = world()
    .unit("soul-harvest-source", { owner: "A", zone: "chain" })
    .unit("weak-unit", { owner: "B", zone: "board", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const target = testWorld.ref("weak-unit");
  const run = runInstruction(definition, { target: "small-unit" }, {
    world: testWorld,
    targets: { "small-unit": [target] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("weak-unit")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [target]);
});

test("replacement hook (Zhonya's Hourglass pattern, CR 369.1): kill replaced → negated", () => {
  const testWorld = world()
    .unit("angel-source", { owner: "A", zone: "chain" })
    .unit("protected-unit", unitAtBattlefield("protected-unit", "A"))
    .build();
  const target = testWorld.ref("protected-unit");
  testWorld.addReplacement(action => action.type === "kill" ? "replaced" : null);
  const run = runInstruction(definition, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [target] }
  });
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  // 替代发生：对象未被消灭，仍在场上（由替代效果自身决定去向，本原语不处理）。
  assert.equal(testWorld.getObject("protected-unit")?.zone, "board");
  assert.equal(run.events.length, 1);
});

test("target left the zone before resolution (stale zoneEntryId) → ignored", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("fleeing-unit", unitAtBattlefield("fleeing-unit", "B"))
    .build();
  const staleRef = testWorld.ref("fleeing-unit");
  // 对象先离开场上（例如被回手），旧 zoneEntryId 引用随之失效。
  testWorld.perform({ type: "return-to-hand", object: staleRef });
  const run = runInstruction(definition, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [staleRef] }
  });
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.equal(run.events.length, 0);
  // 未被误杀：对象仍在手牌。
  assert.equal(testWorld.getObject("fleeing-unit")?.zone, "hand");
});

test("count 0: executes with no events and links an empty killed list", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("bystander", unitAtBattlefield("bystander", "B"))
    .build();
  const target = testWorld.ref("bystander");
  const run = runInstruction(definition, {
    target: "candidates",
    count: { kind: "constant", value: 0 }
  }, {
    world: testWorld,
    targets: { candidates: [target] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked?.killed, []);
  assert.equal(testWorld.getObject("bystander")?.zone, "board");
});

test("count exceeds available targets → negated (impossible)", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("only-one", unitAtBattlefield("only-one", "B"))
    .build();
  const target = testWorld.ref("only-one");
  const run = runInstruction(definition, {
    target: "candidates",
    count: { kind: "constant", value: 2 }
  }, {
    world: testWorld,
    targets: { candidates: [target] }
  });
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.equal(testWorld.getObject("only-one")?.zone, "board");
});

test("choose suspends without an answer and replays with the chosen objects", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("unit-one", unitAtBattlefield("unit-one", "B"))
    .unit("unit-two", unitAtBattlefield("unit-two", "B"))
    .build();
  const first = testWorld.ref("unit-one");
  const second = testWorld.ref("unit-two");
  const args = { target: "candidates", count: { kind: "constant", value: 1 } };
  const targets = { candidates: [first, second] };

  // 无答案：挂起，世界保持不变。
  const asked = runInstruction(definition, args, { world: testWorld, targets });
  assert.equal(asked.result, null);
  assert.ok(asked.asked);
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  assert.equal(testWorld.getObject("unit-one")?.zone, "board");
  assert.equal(testWorld.getObject("unit-two")?.zone, "board");

  // 带答案重跑：只消灭被选择的单位。
  const replayed = runInstruction(definition, args, {
    world: testWorld,
    targets,
    answers: { [asked.asked.request.id]: [second] }
  });
  assert.equal(replayed.result?.status, "executed");
  assert.equal(testWorld.getObject("unit-one")?.zone, "board");
  assert.equal(testWorld.getObject("unit-two")?.zone, "trash");
  assert.deepEqual(replayed.linked?.killed, [second]);
});

test("kill all resolved targets when count is omitted (Thermo Beam pattern: Kill all units)", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("ally", unitAtBattlefield("ally", "A"))
    .unit("enemy-one", unitAtBattlefield("enemy-one", "B"))
    .unit("enemy-two", unitAtBattlefield("enemy-two", "B", "battlefield-2"))
    .build();
  const refs = ["ally", "enemy-one", "enemy-two"].map(id => testWorld.ref(id));
  const run = runInstruction(definition, { target: "all-units" }, {
    world: testWorld,
    targets: { "all-units": refs }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.events.length, 3);
  assert.equal(testWorld.getObject("ally")?.zone, "trash");
  assert.equal(testWorld.getObject("enemy-one")?.zone, "trash");
  assert.equal(testWorld.getObject("enemy-two")?.zone, "trash");
  assert.equal(run.linked?.killed?.length, 3);
});

test("picks mode (non-target choice, CR 3.4 picks do not trigger targeting) kills picked refs", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .unit("picked-unit", unitAtBattlefield("picked-unit", "B"))
    .build();
  const picked = testWorld.ref("picked-unit");
  const run = runInstruction(definition, { picks: "sacrifice-pick" }, {
    world: testWorld,
    picks: { "sacrifice-pick": [picked] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("picked-unit")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [picked]);
});

test("only objects currently on the board can be killed (CR 429.2.a): target in hand is invalid → ignored", () => {
  const testWorld = world()
    .unit("source", { owner: "A", zone: "chain" })
    .card("hand-card", { owner: "B", zone: "hand" })
    .build();
  const target = testWorld.ref("hand-card");
  const run = runInstruction(definition, { target: "illegal-target" }, {
    world: testWorld,
    targets: { "illegal-target": [target] }
  });
  assert.equal(run.result?.status, "ignored");
  assert.equal(testWorld.getObject("hand-card")?.zone, "hand");
});

test("argsSchema rejects invalid args (missing target/picks/self)", () => {
  assert.throws(() => definition.argsSchema.parse({}), /effect\.kill requires/);
  assert.throws(() => definition.argsSchema.parse({ target: 1 }), /args\.target/);
  assert.throws(() => definition.argsSchema.parse({ target: "t", count: 5 }), /args\.count/);
  assert.doesNotThrow(() => definition.argsSchema.parse({ self: true }));
  assert.doesNotThrow(() => definition.argsSchema.parse({ target: "t", count: { kind: "constant", value: 1 } }));
});

test("unl-048-219 Trevor Snoozebottom Sprite token: Temporary kill at Beginning Phase (CR 816.1.b)", () => {
  // Temporary 的触发式 "kill this" 以 self 模式建模；消灭归因备注由触发方提供。
  const base = world()
    .object("sprite-token", { owner: "A", zone: "board", types: ["unit"], isToken: true, might: 3, tags: ["Fae"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const token = base.ref("sprite-token");
  const testWorld = new TestWorld({ state: base.snapshot(), source: token });
  const run = runInstruction(definition, { self: true, reason: "temporary" }, {
    world: testWorld
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("sprite-token")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [token]);
});
