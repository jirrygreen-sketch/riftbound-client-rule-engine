import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/jarvan-iv-royal-heir.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import Assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import Tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7218705147869fc19076fda9afe7138fbf4e76073f7e76ef76bb5cb0d67feee9";
const TARGET_ID = "jarvan-iv-royal-heir.unit-you-control";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const triggered = () => program.abilities[2];

test("rad-133-167 Jarvan IV, Royal Heir: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.doesNotMatch(program.judgeReason, /KeywordDef 仍只是声明/);
  assert.equal(
    program.sourceText,
    "[Assault] (+1 :rb_might: while I'm attacking.)\n" +
      "[Tank] (I must be assigned combat damage first.)\n" +
      "When I attack, you may move a unit you control to my battlefield."
  );
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault] + [Tank] 声明与 383.3.a 的可选攻击触发", () => {
  assert.equal(program.abilities.length, 3);
  const [assault, tank, attack] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → Finalize 时决定是否执行该触发能力。
  assert.equal(attack.optional, true);

  assert.equal(attack.body.length, 1);
  const instruction = attack.body[0];
  assert.equal(instruction.id, "jarvan-iv-royal-heir.move-unit-to-my-battlefield");
  assert.equal(instruction.op, "effect.move");
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { target: TARGET_ID } });
  // "to my battlefield"：来源的当前位置在结算时求值。
  assert.deepEqual(instruction.args.to, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(instruction.targets[0].filter, { type: "unit", zone: "board", controller: "controller" });
  assert.equal(instruction.targets[0].selection, "one");
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-133-167 Jarvan IV, Royal Heir: 触发的移动把己方单位移到来源战场（448-455）", () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD, might: 7 })
    .unit("ally", { location: { type: "base", player: "A" }, might: 2 })
    .build();
  const allyRef = kernel.ref("ally");
  const instruction = triggered().body[0];
  const run = runInstruction(
    move,
    {
      objects: instruction.args.objects,
      // 参考内核用运行时引用表达来源位置；静态 IR 里是 ObjectSelector "source"。
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: instruction.args.amount
    },
    { world: kernel, targets: { [TARGET_ID]: [allyRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.objects, [allyRef]);
  assert.deepEqual(run.linked.moved.movements, [
    { object: allyRef, from: { type: "base", player: "A" }, to: BATTLEFIELD }
  ]);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("rad-133-167 Jarvan IV, Royal Heir: 已在目标战场的单位不算移动" , () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD })
    .unit("ally", { location: BATTLEFIELD })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: TARGET_ID } },
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
  assert.deepEqual(run.events, []);
});

test("rad-133-167 Jarvan IV, Royal Heir: 目标离区后指令 ignored（359.3.e.5–e.8）", () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD })
    .unit("ally", { location: { type: "base", player: "A" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: TARGET_ID } },
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});


test("rad-133-167 Jarvan IV, Royal Heir: the production query resolves the friendly controller and moves the ally", () => {
  // Finalize resolves "controller" to the ability controller; the real body
  // then finds the friendly Base unit rather than ignoring the instruction.
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD, might: 7 })
    .unit("ally", { location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("jarvan") });
  scoped.setTargets(TARGET_ID, [kernel.ref("ally")]);
  const context = bindResolveContext(scoped, { source: kernel.getObject("jarvan"), controller: "A",
    query: filter => scoped.query({ ...filter, ...(filter.controller === "self" ? { controller: "A" } : {}) }) });
  const outcome = runAbilityBody(triggered().body, context, undefined, { host: kernel.ref("jarvan") });
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(scoped.getObject("ally").location, { type: "battlefield", id: "battlefield-1" });
  // 声明的静态形状本身是正确的符号选择器（不是运行时 ObjectRef）。
  assert.equal(triggered().body[0].args.to.kind, "object-property");
  assert.equal(triggered().body[0].args.to.object, "source");
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault] 展开本体属于关键词文件，卡牌只声明", () => {
  const expanded = Assault.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "continuous.might");
  assert.equal(expanded[0].effect.amount.value, 1);
  // 卡牌程序里没有重复实现 Assault 的 Might 加值。
  assert.equal(
    program.abilities.filter(ability => ability.kind === "static" && ability.effect.kind === "continuous.might").length,
    0
  );
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault]'s designation condition evaluates for an attacker", () => {
  // 807.1.c: the `designation` characteristic resolves to the live combat role
  // for an attacker, so the keyword's conditional +1 can open.
  const expansion = Assault.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion[0].condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  const kernel = world().unit("jarvan", { might: 7, combatRole: "attacker" }).build();
  const environment = {
    context: bindResolveContext(kernel, { source: kernel.getObject("jarvan") }),
    host: kernel.ref("jarvan"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(evaluateCondition(expansion[0].condition, environment), true);
  // The characteristic the contract does provide evaluates true for the same unit.
  assert.equal(
    evaluateCondition(
      { ...expansion[0].condition, left: { kind: "object-property", object: "self", property: "combatRole" } },
      environment
    ),
    true
  );
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault] adds 1 Might to an attacker", () => {
  // The production static binder evaluates the designation gate against the
  // attacker's current combat role.
  const kernel = world().unit("jarvan", { might: 7, combatRole: "attacker" }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(Assault.expand({ host: { canonicalCardId: CANONICAL } })[0], kernel.getObject("jarvan"));
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("jarvan")).might, 8);
});

test("rad-133-167 Jarvan IV, Royal Heir boundary: [Tank] binds but has no damage-assignment consumer", () => {
  // 815.1.b/c: Tank must force lethal damage first. The merged KeywordDef
  // expands to a continuous.combat declaration, but binding it changes nothing
  // observable on the layered snapshot, and no combat allocation path reads it.
  const expansion = Tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].effect.kind, "continuous.combat");
  assert.equal(expansion[0].effect.mode, "damage-assignment");

  const kernel = world().unit("jarvan", { might: 7 }).unit("other", { might: 1 }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(expansion[0], kernel.getObject("jarvan"));
  engine.layers.setObjects(kernel.objects);
  const layered = engine.layers.evaluate(kernel.ref("jarvan"));
  assert.equal(layered.might, 7);
  assert.deepEqual(layered.keywords, []);
  assert.equal(kernel.getObject("other").might, 1);
});

test("rad-133-167 Jarvan IV, Royal Heir boundary: the attack trigger registers and matches only its own attacker", () => {
  // 383.4.e / 323.2: the attack trigger compiles through the merged adapter and
  // matches the source object's attack-declared event, not another unit's.
  const kernel = world()
    .object("jarvan", { cardId: CANONICAL, types: ["unit"], might: 7 })
    .unit("other", { might: 2 })
    .build();
  const registration = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    kernel.getObject("jarvan")
  )[0];
  assert.equal(registration.spec.at, "attack-declared");
  assert.deepEqual(registration.spec.filter, { objectId: "jarvan" });
  const ownAttack = { timingPoint: "attack-declared", kind: "attack-declared", player: "A", object: kernel.getObject("jarvan") };
  assert.equal(matchesTriggerEvent(registration.spec.filter, ownAttack, "A"), true);
  const otherAttack = { ...ownAttack, object: kernel.getObject("other") };
  assert.equal(matchesTriggerEvent(registration.spec.filter, otherAttack, "A"), false);
});
