import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mordekaiser-dominating.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { buildDiscardCostPlan, payDiscardCostPlan } from "../../../../engine-core/dist/cost/kinds/discard.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";

const CANONICAL = "card.hash-e9fc2b80d00083fe6d3d05f817392c9995133d2b989fa879251804de73b2df15";
const TARGET_ID = "mordekaiser-dominating.unit-or-gear";

const abilities = () => program.abilities;

function layerContext(kernel, source = kernel.source) {
  return bindResolveContext(kernel, {
    source,
    query: filter => new LayerEngine(kernel.objects).evaluateAll().filter(object => matchesObjectFilter(filter, object))
  });
}

test("rad-137-167 Mordekaiser, Dominating: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("383.3.b"), true);
  assert.match(program.judgeReason, /TriggeredAbility 没有 cost 字段/);
  assert.match(program.judgeReason, /TriggerRegistration.cost/);
  assert.match(program.judgeReason, /PickSpec\.filter/);
  assert.equal(program.sourceText, "When you play me or when I attack, you may discard 1 to kill a unit or gear.");
});

test("rad-137-167 Mordekaiser, Dominating: 打出/攻击两个可选触发，本体是 kill unit or gear", () => {
  assert.equal(program.abilities.length, 2);
  const [onPlay, onAttack] = abilities();

  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → Finalize 时决定是否执行该触发能力。
  assert.equal(onPlay.optional, true);

  assert.equal(onAttack.kind, "triggered");
  assert.equal(onAttack.trigger.at, "attack-declared");
  assert.deepEqual(onAttack.trigger.filter, { self: true });
  assert.equal(onAttack.optional, true);

  for (const [label, ability, id] of [
    ["play", onPlay, "mordekaiser-dominating.kill-on-play"],
    ["attack", onAttack, "mordekaiser-dominating.kill-on-attack"]
  ]) {
    assert.equal(ability.body.length, 1, label);
    const instruction = ability.body[0];
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "effect.kill");
    assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
    assert.equal(instruction.targets.length, 1);
    assert.deepEqual(instruction.targets[0].filter, { type: ["unit", "gear"], zone: "board" });
    assert.equal(instruction.targets[0].min, 1);
    assert.equal(instruction.targets[0].max, 1);
    assert.equal(instruction.targets[0].selection, "one");
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.picks, undefined);
  }
});

test("rad-137-167 Mordekaiser, Dominating: 383.3.b 的 \"discard 1\" 是 Finalize 基础费用，未被降级为结算效果", () => {
  // 效果侧只声明 kill；"discard 1" 不是 body 指令。把它写成 body 首条 effect.discard
  // 会把 383.3.b/204.1.c 的 Finalize 费用降级为结算效果（355.10.c.1 要求代价先行），
  // 因此本程序在缺少 triggered.cost 字段的情况下不写入该指令。
  for (const ability of abilities()) {
    assert.equal(ability.body.some(instruction => instruction.op === "effect.discard"), false);
  }
});

test("rad-137-167 Mordekaiser, Dominating boundary: production registrations carry no trigger cost", () => {
  // Re-probed 2026-10-17: TriggeredAbility has no cost field and
  // programs/triggers.ts forwards nothing, so Finalize can never charge the
  // mandatory discard even though chain/engine.ts would consume a registration
  // cost if one existed.
  const kernel = world().unit("mordekaiser", { cardId: CANONICAL, types: ["unit"], might: 8 }).build();
  const registrations = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    kernel.getObject("mordekaiser")
  );
  assert.equal(registrations.length, 2);
  for (const registration of registrations) {
    assert.equal(Object.hasOwn(registration, "cost"), false);
  }
  assert.equal(program.abilities.some(ability => Object.hasOwn(ability, "cost")), false);
});

test("rad-137-167 Mordekaiser, Dominating: effect.kill 对锁定的装备目标真实执行", () => {
  const kernel = world()
    .unit("mordekaiser", { location: { type: "battlefield", id: "battlefield-1" }, might: 8 })
    .unit("enemy-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const gearRef = kernel.ref("enemy-gear");
  const instruction = abilities()[0].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [gearRef]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("rad-137-167 Mordekaiser, Dominating: effect.kill 对锁定的单位目标真实执行", () => {
  const kernel = world().unit("mordekaiser", {}).unit("enemy-unit", {}).build();
  const unitRef = kernel.ref("enemy-unit");
  const instruction = abilities()[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [unitRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  assert.equal(kernel.getObject("mordekaiser").zone, "board");
});

test("rad-137-167 Mordekaiser, Dominating: the original kill body ignores a stale finalized target", () => {
  const kernel = world().unit("mordekaiser").unit("enemy-unit").build();
  const target = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: target });
  kernel.setTargets(TARGET_ID, [target]);
  const outcome = resolveChainBody(abilities()[0].body, layerContext(kernel));
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.events.filter(event => event.action === "kill").length, 1);
});

test("rad-137-167 Mordekaiser, Dominating: both original trigger bodies execute their unit-or-gear targets", () => {
  for (const [index, type] of ["unit", "gear"].entries()) {
    const kernel = world().unit("mordekaiser").unit("victim", { owner: "B", types: [type] }).build();
    kernel.setTargets(TARGET_ID, [kernel.ref("victim")]);
    const outcome = resolveChainBody(abilities()[index].body, layerContext(kernel));
    assert.equal(outcome.status, "executed");
    assert.equal(outcome.results[0].id, abilities()[index].body[0].id);
    assert.equal(kernel.getObject("victim").zone, "trash");
    assert.equal(kernel.getObject("mordekaiser").zone, "board");
    assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
  }
});

test("rad-137-167 Mordekaiser, Dominating: the merged discard cost pays before the kill body", () => {
  const kernel = world().unit("mordekaiser").unit("enemy", { owner: "B" }).hand("payment").build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  // The cost engine already accepts runtime choices. The missing CardProgram
  // trigger-cost field is not supplied or bypassed by this isolated cost test.
  const plan = buildDiscardCostPlan(scoped, { object: scoped.ref("payment") }, { id: "morde:discard" });
  const receipt = payDiscardCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.equal(scoped.getObject("payment").zone, "trash");
  scoped.setTargets(TARGET_ID, [scoped.ref("enemy")]);
  const outcome = resolveChainBody(abilities()[0].body, layerContext(scoped));
  assert.equal(outcome.status, "executed");
  assert.equal(scoped.getObject("enemy").zone, "trash");
  assert.deepEqual(scoped.events.map(event => event.action), ["pay", "discard", "kill"]);
});

test.todo('Mordekaiser, Dominating: declare and bind the leading discard as TriggerRegistration.cost, including its non-target hand selection, before Finalize of both optional triggers (CR 383.3.b).');
