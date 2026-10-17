import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mournful-spirit.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-32901e49217e3463bf29df57238a9370865527412373a7daa3ca361f82eb7a09";
const TARGET_ID = "mournful-spirit.unit-or-gear-here";

function layerContext(kernel, source = kernel.source) {
  return bindResolveContext(kernel, {
    source,
    query: filter => new LayerEngine(kernel.objects).evaluateAll().filter(object => matchesObjectFilter(filter, object))
  });
}

test("rad-126-167 Mournful Spirit: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /808\.1\.d\.3/);
  assert.match(program.judgeReason, /sameLocationAs: source/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.equal(program.sourceText, "[Deathknell][>] You may kill a unit or gear here. (When I die, get the effect.)");
});

test("rad-126-167 Mournful Spirit: Deathknell keyword + 383.3.a optional object-killed trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [deathknell, triggered] = program.abilities;
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → 在 Finalize 决定是否执行该触发能力。
  assert.equal(triggered.optional, true);

  assert.equal(triggered.body.length, 1);
  const instruction = triggered.body[0];
  assert.equal(instruction.id, "mournful-spirit.kill-unit-or-gear");
  assert.equal(instruction.op, "effect.kill");
  // 355.10.c/204.3：此处是效果（不是费用）→ "a unit or gear" 用 TargetSpec。
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.deepEqual(spec.filter, { type: ["unit", "gear"], zone: "board", sameLocationAs: "source" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-126-167 Mournful Spirit: effect.kill 对锁定的装备目标真实执行", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .unit("far-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const gearRef = kernel.ref("here-gear");
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [gearRef]);
  assert.equal(kernel.getObject("here-gear").zone, "trash");
  // 同在场的另一个战场上的装备不受影响（"here" 限制由目标系统在 Finalize 施加）。
  assert.equal(kernel.getObject("far-gear").zone, "board");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("rad-126-167 Mournful Spirit: 目标在结算前离区 → 指令 ignored（359.3.e.5–e.8）", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("here-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.events.filter(event => event.action === "kill").length, 1);
});

test("rad-126-167 Mournful Spirit: 声明形状下 effect.kill 走真实 kill 动作并写链接值", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const unitRef = kernel.ref("here-unit");
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [unitRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [unitRef]);
  assert.equal(kernel.getObject("here-unit").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.equal(run.events[0].timingPoint, "main-start");
});

test("rad-126-167 Mournful Spirit: 429.2.a —— 只有 Board 上的对象能被消灭", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const gearRef = kernel.ref("here-gear");
  // 先把装备移出 Board（战斗单位不可附着，这里用区域移动模拟"已不在场"）。
  kernel.perform({ type: "move-zone", object: gearRef, to: "hand" });
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("here-gear").zone, "hand");
});

test.todo('Mournful Spirit: attach the kill body to its Deathknell instance and translate sameLocationAs source through production target Finalize/Resolve (CR 808.1.c/d, 808.2).');

test("Mournful Spirit: the original unit-or-gear body uses the dead source's last-known location", () => {
  for (const type of ["unit", "gear"]) {
    const kernel = world().unit("spirit", { location: { type: "battlefield", id: "here" } })
      .unit("victim", { types: [type], location: { type: "battlefield", id: "here" } })
      .unit("elsewhere", { types: [type], location: { type: "battlefield", id: "away" } }).build();
    const source = kernel.getObject("spirit");
    kernel.perform({ type: "kill", object: source.ref });
    assert.equal(kernel.object(source.ref), null);
    kernel.setTargets(TARGET_ID, [kernel.ref("victim")]);
    const outcome = resolveChainBody(program.abilities[1].body, layerContext(kernel, source));
    assert.equal(outcome.status, "executed");
    assert.equal(kernel.getObject("victim").zone, "trash");
    assert.equal(kernel.getObject("elsewhere").zone, "board");
    assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
  }
});

test("Mournful Spirit: original here filter rechecks a target that moved to another location", () => {
  const kernel = world().unit("spirit", { location: { type: "battlefield", id: "here" } })
    .unit("victim", { location: { type: "battlefield", id: "here" } }).build();
  const source = kernel.getObject("spirit");
  const target = kernel.ref("victim");
  kernel.perform({ type: "kill", object: source.ref });
  kernel.perform({ type: "move-location", object: target, to: { type: "battlefield", id: "away" } });
  kernel.setTargets(TARGET_ID, [target]);
  const outcome = resolveChainBody(program.abilities[1].body, layerContext(kernel, source));
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("victim").zone, "board");
  assert.deepEqual(outcome.events, []);
});

test("Mournful Spirit: the real death pipeline already captures the Board snapshot for a Pending trigger", () => {
  const f = fixture({ choose: request => request.type === "optional" ? true : undefined });
  const source = f.kernel.getObject("source");
  const ability = program.abilities[1];
  f.engine.pipeline.registerTrigger({
    id: "spirit:death", source, controller: source.controller,
    spec: { at: ability.trigger.at, filter: translateTriggerFilter(ability.trigger.filter, source.ref.id, ability.trigger.at) },
    body: ability.body, optional: ability.optional, boundToIncarnation: true
  });
  f.engine.commit({ type: "kill", object: source.ref });
  assert.equal(f.kernel.getObject("source").zone, "trash");
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].status, "pending");
  assert.deepEqual(f.engine.items[0].source.ref, source.ref);
  assert.equal(f.engine.items[0].source.zone, "board");
  assert.deepEqual(f.engine.items[0].source.location, source.location);
});
