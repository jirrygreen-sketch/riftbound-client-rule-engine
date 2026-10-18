import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/the-ball.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CARD_ID = "card.hash-a086d5c18c686d7dd38aba3317931635118d024917313da10f92dd9561df0e57";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "[Ganking] (While this is a unit, it can move from battlefield to battlefield.)\n" +
  "When you play or move this, choose one —\nDraw 1.Deal 2 to enemy units here.";
const BATTLEFIELD = { type: "battlefield", id: "bf-1" };

const battlefieldWorld = () => world()
  .deck(["top-card"])
  .object("the-ball", { types: ["gear"], tags: ["Device", "Orianna", "Signature"], zone: "board", location: BATTLEFIELD })
  .unit("enemy-here", { owner: "B", controller: "B", location: BATTLEFIELD, might: 4 })
  .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" }, might: 4 })
  .unit("ally-here", { owner: "A", controller: "A", location: BATTLEFIELD, might: 4 })
  .build();

/**
 * 参考内核对 `controller` 只做字面比较（见 testing/README），不理解 "opponent" 占位；
 * 与已合入的 show-of-strength / assembly-rig 等同做法，测试里只把该占位替换为具体对手 id，
 * 卡片 IR 本身保持 "opponent"（生产链路由 Finalize 解析）。
 */
const concretizeOpponent = (body, opponent) => JSON.parse(JSON.stringify(body, (_key, value) =>
  value && typeof value === "object" && value.controller === "opponent"
    ? { ...value, controller: opponent }
    : value));

test("rad-146-167 The Ball: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /source-location/);
  assert.match(program.judgeReason, /invalid-location-kind/);
  assert.match(program.judgeReason, /programs\/triggers\.ts/);
});

test("rad-146-167 The Ball: Deploy + Ganking keywords and play/move mode bodies", () => {
  assert.equal(program.abilities.length, 4);
  const [deploy, ganking, onPlay, onMove] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });

  // “When you play or move this”：两个触发条件共用同一效果（383.4.a / 421.1、449.1）。
  assert.equal(onPlay.kind, "triggered");
  assert.deepEqual(onPlay.trigger, { at: "card-played", filter: { event: "card-played", self: true } });
  assert.equal(onPlay.optional, false);
  assert.equal(onMove.kind, "triggered");
  assert.deepEqual(onMove.trigger, { at: "object-moved", filter: { event: "object-moved", self: true } });
  assert.equal(onMove.optional, false);

  for (const [ability, choiceId] of [[onPlay, "the-ball.play-mode"], [onMove, "the-ball.move-mode"]]) {
    assert.equal(ability.body.length, 1);
    const [choice] = ability.body;
    assert.equal(choice.id, choiceId);
    assert.equal(choice.op, "choice.mode");
    assert.deepEqual(choice.args.count, { kind: "constant", value: 1 });
    assert.deepEqual(choice.args.different, { kind: "constant", value: true });
    assert.equal(choice.args.modes.kind, "constant");
    const [drawMode, damageMode] = choice.args.modes.value;
    assert.deepEqual(choice.args.modes.value.map((mode) => mode.id), [
      "the-ball.draw-mode",
      "the-ball.damage-mode"
    ]);

    const [draw] = drawMode.body;
    assert.equal(draw.id, "the-ball.draw");
    assert.equal(draw.op, "effect.draw");
    assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
    assert.equal(draw.targets, undefined);

    const [damage] = damageMode.body;
    assert.equal(damage.id, "the-ball.damage");
    assert.equal(damage.op, "effect.damage");
    assert.deepEqual(damage.args.amount, { kind: "constant", value: 2 });
    assert.deepEqual(damage.args.target, { kind: "constant", value: "the-ball.enemy-units-here" });
    assert.equal(damage.targets.length, 1);
    const [spec] = damage.targets;
    assert.equal(spec.id, "the-ball.enemy-units-here");
    // “enemy units here”：敌方 + 来源所在地点锚点（解释器集合查询）+ 程序化全选（355.10.d）。
    assert.deepEqual(spec.filter, { type: "unit", controller: "opponent", sameLocationAs: "source" });
    assert.equal(spec.selection, "all");
  }
});

test("rad-146-167 The Ball: draw mode executes and the damage mode is never evaluated", () => {
  const kernel = battlefieldWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("the-ball") });
  scoped.setAnswers({ "the-ball.play-mode/mode%3A0": "the-ball.draw-mode" });
  const outcome = resolveChainBody(program.abilities[2].body, scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(outcome.results.map((result) => result.id), ["the-ball.draw", "the-ball.play-mode"]);
  assert.equal(scoped.player("A").handSize, 1);
  assert.equal(scoped.getObject("enemy-here").damage, 0);
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
});

test("rad-146-167 The Ball: damage mode hits only the enemy units at the source's location", () => {
  const kernel = battlefieldWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("the-ball") });
  // Finalize 锁定后的目标集合同时包含“此处”与别处的候选，由 source-location
  // 目标锚点在解释器内重验（RIFT-357）。
  scoped.setTargets("the-ball.enemy-units-here", [scoped.ref("enemy-here"), scoped.ref("enemy-elsewhere")]);
  scoped.setAnswers({ "the-ball.play-mode/mode%3A0": "the-ball.damage-mode" });
  const outcome = resolveChainBody(concretizeOpponent(program.abilities[2].body, "B"), scoped);
  assert.equal(outcome.results[0].id, "the-ball.damage");
  assert.equal(outcome.results[0].result.status, "executed", JSON.stringify(outcome.results));
  assert.equal(scoped.getObject("enemy-here").damage, 2);
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
  assert.equal(scoped.getObject("ally-here").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
});

test("rad-146-167 The Ball: a mistargeted damage group makes the whole mode instruction partial", () => {
  const kernel = battlefieldWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("the-ball") });
  const stale = scoped.ref("enemy-here");
  scoped.perform({ type: "kill", object: stale });
  scoped.setTargets("the-ball.enemy-units-here", [stale]);
  scoped.setAnswers({ "the-ball.play-mode/mode%3A0": "the-ball.damage-mode" });
  const outcome = resolveChainBody(program.abilities[2].body, scoped);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.find((result) => result.id === "the-ball.damage").result.status, "ignored");
  assert.equal(outcome.results.find((result) => result.id === "the-ball.damage").result.reason, "mistargeted");
  assert.equal(scoped.getObject("enemy-elsewhere").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "rad-146-167 The Ball: [Deploy] 展开（830.1.b）的消费者未合入——continuous.location 没有 layerFor 映射" +
    "（卡牌 static 绑定抛 judge-required；chain/engine.ts 已有 playDestinationIsLegal → playLocations " +
    "位置校验消费者，但绑定先行失败）；hold 触发的 { here: true } 过滤器" +
    "会被 translateTriggerFilter/translateObjectFilter 拒绝（turn/flow.ts 的清理召回已有 Deploy 豁免）"
);

test("rad-146-167 The Ball: the equipment keyword expansions really gate Deploy/here, and Ganking alone binds", () => {
  // 830.1.b / 830.2: the merged production binder registers Ganking's
  // continuous.movement but refuses Deploy's continuous.location, and the
  // hold-trigger filter still carries the unsupported { here: true } field.
  const kernel = world().player("A").player("B")
    .unit("the-ball", { controller: "A", owner: "A", types: ["gear"], zone: "board", location: BATTLEFIELD })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error("Unexpected choice: " + request.id); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  const snapshot = { ...kernel.getObject("the-ball"), cardId: CARD_ID };
  const boundKinds = [];
  const failures = [];
  for (const ability of expandProgram(program, snapshot).abilities) {
    if (ability.kind !== "static") continue;
    try {
      bindStaticAbility(binder, ability, snapshot);
      boundKinds.push(ability.effect.kind);
    } catch (error) {
      failures.push(error.message);
    }
  }
  assert.deepEqual(boundKinds, ["continuous.movement"], "Ganking's movement permission binds");
  assert.deepEqual(failures, ["Static ability kind continuous.location has no layer mapping"]);
  assert.throws(
    () => triggerRegistrations(new Map([[CARD_ID, program]]), snapshot),
    /Unsupported filter field here/
  );
});
test("rad-146-167 The Ball: the source-location target selector really filters by the source's battlefield", () => {
  // 355.10.d / 421.1: the engine's TargetSpec.location { kind: "source-location" }
  // selector really compares a candidate's location with the ability source's.
  // It cannot yet be authored in a CardProgram (the shared IR validator rejects
  // symbolic target locations), so this proves the engine half only.
  const kernel = battlefieldWorld();
  const source = kernel.getObject("the-ball");
  const context = bindResolveContext(kernel, { source, controller: "A", timingPoint: "chain-item-resolve" });
  const plan = finalizeTargetPlan(context, {
    id: "the-ball.enemy-units-here",
    filter: { type: "unit", controller: "B" },
    location: { kind: "source-location" },
    selection: "all"
  }, {});
  assert.deepEqual(plan.selected.map(ref => ref.id), ["enemy-here"]);
});

test("rad-146-167 The Ball: the shared CardProgram validator rejects the merged source-location selector", () => {
  // Contract gap: the engine accepts TargetSpec.location selectors, but
  // ir/validation.ts validateTargetSpec routes every non-concrete location to
  // validateLocationFilter, so { kind: "source-location" } fails as a bad kind.
  const result = validateCardProgram({
    ...program,
    abilities: [
      { kind: "keyword", keyword: "deploy" },
      {
        kind: "triggered",
        trigger: { at: "card-played", filter: { event: "card-played", self: true } },
        optional: false,
        body: [{
          id: "probe.damage",
          op: "effect.damage",
          args: { amount: { kind: "constant", value: 2 }, target: { kind: "constant", value: "probe.target" } },
          targets: [{
            id: "probe.target",
            filter: { type: "unit", controller: "opponent" },
            location: { kind: "source-location" },
            selection: "all"
          }]
        }]
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "invalid-location-kind"));
});

test.todo(
  "rad-146-167 The Ball: “enemy units here” 的生产链路——引擎的 source-location 目标选择器可求值，但共享 IR 校验器" +
    "拒绝在 CardProgram 里写符号 location（invalid-location-kind，见契约变更请求）；choice.mode 又被 " +
    "chain/engine.ts 的 assertFinalizationSurface 拒绝，模式体到不了 Finalize"
);
test.todo(
  "rad-146-167 The Ball: object-moved 触发端到端（421.1/449.1 移动成功时点 + 来源身份锚定 + Ganking 许可）——" +
    "触发注册已合入，但 choice.mode 会被 programs/play.ts 的 validateSurface 拒绝（需要 choice-plan 适配器）"
);
test.todo(
  "rad-146-167 The Ball: card-played 触发端到端订阅（383.4.a / 407）——触发注册已合入，" +
    "剩余缺口是 choice.mode 的 Finalize/Resolve 适配器"
);
