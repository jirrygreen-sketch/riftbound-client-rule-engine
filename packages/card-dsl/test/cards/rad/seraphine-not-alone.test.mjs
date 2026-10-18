import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/seraphine-not-alone.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding, ProgramBindingError } from "../../../../engine-core/dist/programs/index.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-628d472ac3458206c95d893f3af0ac4bc4561ccd533988196a3c1c20ccd7eb20";
const BASE = { type: "base", player: "A" };

const abilities = () => program.abilities;

test("rad-138-167 Seraphine, Not Alone: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.match(program.judgeReason, /per\(count\)/);
  assert.match(program.judgeReason, /resolveChainBody/);
  assert.doesNotMatch(program.judgeReason, /Invalid effect\.token argument/);
  assert.equal(
    program.sourceText,
    "When you play me or when I become exhausted, play a 1 :rb_might: Recruit unit token to your base.\n" +
      "I have +1 :rb_might: for each other exhausted unit you control."
  );
});

test("rad-138-167 Seraphine, Not Alone: 打出/成为横置两个触发 + 变量 Might 静态能力", () => {
  assert.equal(program.abilities.length, 3);
  const [onPlay, onExhausted, might] = abilities();

  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { self: true });
  assert.equal(onPlay.optional, false);

  // 415.1：从 Ready 变为 Exhausted 的时点；415.1.c 对已横置对象再横置不产生事件。
  assert.equal(onExhausted.kind, "triggered");
  assert.equal(onExhausted.trigger.at, "object-exhausted");
  assert.deepEqual(onExhausted.trigger.filter, { self: true });
  assert.equal(onExhausted.optional, false);

  for (const [label, ability, id] of [
    ["play", onPlay, "seraphine-not-alone.play-recruit-on-play"],
    ["exhausted", onExhausted, "seraphine-not-alone.play-recruit-on-exhaust"]
  ]) {
    assert.equal(ability.body.length, 1, label);
    const instruction = ability.body[0];
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "effect.token");
    // 187.1：1 Might Recruit 单位衍生物（领域无关、能量/力量为 null）。
    assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // 440.2.c/185.2.a：被打出的衍生物先在链上创建再交付 play。
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
    // "to your base"：控制器基地（参考内核按具体玩家结算该位置）。
    assert.deepEqual(instruction.args.locations, {
      kind: "constant",
      value: [{ type: "base", player: "controller" }]
    });
    assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "recruitToken" });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }

  // "I have +1 Might for each other exhausted unit you control"：持续变量加值。
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 1 },
    per: {
      kind: "count",
      subject: "units",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        states: "exhausted",
        exclude: "self"
      }
    }
  });
  assert.equal(might.condition, undefined);
});

test("rad-138-167 Seraphine, Not Alone: effect.token 按 187.1 把 1 Might Recruit 打到底座", () => {
  const kernel = world().unit("seraphine", {}).build();
  const instruction = abilities()[0].body[0];
  const run = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      // 参考内核不解析 "controller" 占位符；静态 IR 里保留占位，执行时给出具体玩家基地。
      locations: { kind: "constant", value: [BASE] },
      choiceId: instruction.args.choiceId,
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Recruit");
  assert.equal(created[0].might, 1);
  assert.deepEqual(created[0].tags, ["Recruit"]);
  assert.deepEqual(created[0].location, BASE);
  // 185.3：衍生物无印刷费用，不得写成 0。
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.equal(created[0].owner, "A");
  assert.equal(created[0].controller, "A");
  // 185.2.a/440.2.c：创建在链上，再由 play 交付（打出事件）。
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(run.events[1].timingPoint, "card-played");
  assert.equal(kernel.pendingItems.length, 0);
  assert.equal(run.linked.recruitToken.amount, 1);
});

test("rad-138-167 Seraphine, Not Alone: 两个触发都按声明形状创建衍生物（一次一个）", () => {
  for (const ability of abilities().slice(0, 2)) {
    const kernel = world().unit("seraphine", {}).build();
    const instruction = ability.body[0];
    const run = runInstruction(
      token,
      {
        token: instruction.args.token,
        amount: instruction.args.amount,
        mode: instruction.args.mode,
        locations: { kind: "constant", value: [BASE] },
        choiceId: instruction.args.choiceId,
        linkKey: instruction.args.linkKey
      },
      { world: kernel }
    );
    assert.equal(run.result.status, "executed");
    assert.equal(kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken).length, 1);
  }
});

function bodyAtControllerBase(ability) {
  // The static program uses the contract placeholder "controller". The test
  // context supplies the concrete PlayerId while keeping the original body,
  // primitive, and chain adapter unchanged.
  return ability.body.map(instruction => ({
    ...instruction,
    args: {
      ...instruction.args,
      locations: { kind: "constant", value: [BASE] }
    }
  }));
}

for (const [label, ability] of [
  ["when played", abilities()[0]],
  ["when becoming exhausted", abilities()[1]]
]) {
  test("rad-138-167 Seraphine, Not Alone: " + label + " trigger resolves Recruit through resolveChainBody", () => {
    const kernel = world()
      .unit("seraphine", { owner: "A", controller: "A", location: BASE })
      .build();
    const scoped = kernel.clone({
      source: kernel.ref("seraphine"),
      sourceSnapshot: kernel.getObject("seraphine")
    });
    const outcome = resolveChainBody(bodyAtControllerBase(ability), scoped);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
      [ability.body[0].id, "executed"]
    ]);
    const [recruit] = scoped.objects.filter(object => object.isToken);
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.location, BASE);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
    assert.deepEqual(scoped.events.map(event => event.action), ["create-token", "play"]);
  });
}

test("rad-138-167 Seraphine, Not Alone: per 计数的 \"other exhausted unit\" 集合可被真实查询求值", () => {
  // 参考测试内核的 query 只处理 type/types/tag/tags/controller/owner/zone/location（忽略
  // states），而生产图层过滤器（layers/filter.matchesObjectFilter）实现 states 匹配。
  // 这里组合两者：内核提供真实对象集合与身份，生产过滤器判定"已横置"。
  const declared = abilities()[2].effect.per.filter;
  assert.deepEqual(declared, {
    type: "unit",
    zone: "board",
    controller: "controller",
    states: "exhausted",
    exclude: "self"
  });
  // 生产链解析 "controller" 占位符；参考执行里替换为具体玩家 A。
  const resolved = { ...declared, controller: "A" };
  const kernel = world()
    .unit("seraphine", { exhausted: true })
    .unit("ally-exhausted", { exhausted: true })
    .unit("ally-exhausted-2", { exhausted: true })
    .unit("ally-ready", { exhausted: false })
    .unit("enemy-exhausted", { owner: "B", exhausted: true })
    .build();
  const selfRef = kernel.ref("seraphine");
  const others = kernel
    .query({ type: "unit", zone: "board", controller: "A" })
    .filter(object => !(object.ref.id === selfRef.id && object.ref.zoneEntryId === selfRef.zoneEntryId))
    .filter(object => matchesObjectFilter(resolved, {
      ...object,
      printed: object,
      actionTimings: [],
      availableTimings: [],
      movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
      text: null,
      effectText: null
    }));

  // 恰好 2 个己方"其他已横置"单位：Seraphine 自己（exclude self）、已就绪的友军
  // （states: exhausted）与敌方单位（controller）都不计入。
  assert.deepEqual(others.map(object => object.name).sort(), ["ally-exhausted", "ally-exhausted-2"]);
});

function bindingFixture({ exhaustedAllies = 0, executable = true } = {}) {
  // Only the local copy bypasses the card's judge-required admission gate so
  // the supported registration path can be tested with the declared abilities.
  const candidate = { ...program };
  if (executable) {
    candidate.status = "executable";
    // judgeReason must not survive on an executable program.
    delete candidate.judgeReason;
  }
  const binding = createProgramBinding({ cardPrograms: [candidate] });
  const builder = world()
    .player("A")
    .player("B")
    .hand("seraphine", { cardId: CANONICAL, types: ["unit"], might: 1, energy: 5, power: ["Order"] })
    .unit("ally-ready", { exhausted: false })
    .unit("enemy-exhausted", { owner: "B", controller: "B", exhausted: true });
  for (let index = 0; index < exhaustedAllies; index++) {
    builder.unit(`ally-exhausted-${index}`, { exhausted: true });
  }
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const bindingErrors = [];
  const lifecycle = attachProgramLifecycle(engine, binding.registry, undefined, (error, source) => {
    bindingErrors.push({ error, source });
    throw error;
  });
  return { binding, kernel, engine, lifecycle, bindingErrors };
}

test("rad-138-167 Seraphine, Not Alone: lifecycle binds both triggers and only self-exhaust creates a Pending ability", t => {
  const { binding, kernel, engine, lifecycle, bindingErrors } = bindingFixture();
  t.after(() => lifecycle.detach());
  assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("seraphine"), to: "board", location: BASE }).status, "done");
  assert.deepEqual(bindingErrors, []);
  const registrations = triggerRegistrations(binding.registry, kernel.getObject("seraphine"));
  assert.equal(registrations.length, 2);
  assert.deepEqual(
    registrations.map((registration) => registration.spec.at).sort(),
    ["card-played", "object-exhausted"]
  );
  for (const registration of registrations) {
    assert.deepEqual(registration.activeZones, ["board"]);
    assert.equal(registration.id.startsWith("program:seraphine:"), true);
  }
  assert.deepEqual([...engine.pipeline.checkpoint().triggers.keys()], registrations.map(registration => registration.id));
  assert.equal(engine.items.length, 0);

  assert.equal(engine.commit({ type: "exhaust", object: kernel.ref("ally-ready") }).status, "done");
  assert.equal(engine.items.length, 0, "another unit becoming exhausted does not trigger Seraphine");
  assert.equal(engine.commit({ type: "exhaust", object: kernel.ref("seraphine") }).status, "done");
  const exhaustEvent = engine.pipeline.events.findLast(event => event.timingPoint === "object-exhausted");
  assert.equal(exhaustEvent.object.ref.id, "seraphine");
  assert.equal(kernel.getObject("seraphine").exhausted, true);
  assert.deepEqual(bindingErrors, []);
  assert.equal(engine.items.length, 1);
  const [pending] = engine.items;
  assert.equal(pending.status, "pending");
  assert.equal(pending.kind, "triggered");
  assert.equal(pending.trigger.event.eventId, exhaustEvent.eventId);
  assert.equal(pending.trigger.registration.spec.at, "object-exhausted");
  assert.deepEqual(pending.body, abilities()[1].body);
  // This proves detection and registration only. The unsupported token body
  // and the per-count Might result retain their separate TODOs.
});

test("rad-138-167 Seraphine, Not Alone: shipped judge-required binding fails explicitly and rolls back the board entry", t => {
  const { kernel, engine, lifecycle, bindingErrors } = bindingFixture({ executable: false });
  t.after(() => lifecycle.detach());
  const savedWorld = kernel.snapshot();
  const savedEvents = engine.pipeline.events;
  assert.throws(
    () => engine.commit({ type: "move-zone", object: kernel.ref("seraphine"), to: "board", location: BASE }),
    error => error instanceof ProgramBindingError && error.code === "judge-required" && error.message === program.judgeReason
  );
  assert.equal(bindingErrors.length, 1);
  assert.equal(bindingErrors[0].source.ref.id, "seraphine");
  assert.equal(bindingErrors[0].error.code, "judge-required");
  assert.deepEqual(kernel.snapshot(), savedWorld);
  assert.deepEqual(engine.pipeline.events, savedEvents);
  assert.equal(engine.pipeline.checkpoint().triggers.size, 0);
  assert.equal(engine.items.length, 0);
});

test("rad-138-167 Seraphine, Not Alone: the declared per(count) static really registers but is not consumed", () => {
  // The card is lifted only to let the merged static binder run; the declared
  // per(count) shape is registered verbatim and the layer engine ignores it.
  const candidate = { ...program, status: "executable" };
  delete candidate.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [candidate] });
  const kernel = world().unit("seraphine", { might: 1 }).unit("ally-exhausted", { exhausted: true }).build();
  const self = kernel.getObject("seraphine");
  const engine = createLayerEngine([self]);
  const staticAbility = candidate.abilities.find((ability) => ability.kind === "static");
  const { effect } = staticAbility;
  engine.register({
    id: "seraphine-might",
    source: self.ref,
    filter: { objectId: self.ref.id, zone: "board" },
    layer: effect.layer,
    effect: {
      kind: effect.kind,
      mode: effect.mode,
      amount: effect.amount,
      per: effect.per
    }
  }, { type: "permanent" });
  assert.equal(engine.registry.list().length, 1);
  assert.deepEqual(engine.registry.list()[0].effect.effect.per, {
    kind: "count",
    subject: "units",
    filter: {
      type: "unit",
      zone: "board",
      controller: "controller",
      states: "exhausted",
      exclude: "self"
    }
  });
  // Actual observed behavior: numberValue reads only the scalar amount, so the
  // Might is 1 + 1 (fixed) regardless of how many other units are exhausted.
  assert.equal(engine.evaluate(self.ref).might, 2);
});

for (const exhaustedAllies of [0, 3]) {
  test.todo(`rad-138-167 Seraphine, Not Alone: per(count) gives Might ${1 + exhaustedAllies} for ${exhaustedAllies} other exhausted friendly units`, t => {
    const { kernel, engine, lifecycle, bindingErrors } = bindingFixture({ exhaustedAllies });
    t.after(() => lifecycle.detach());
    assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("seraphine"), to: "board", location: BASE }).status, "done");
    assert.deepEqual(bindingErrors, []);
    const counted = kernel.query({ type: "unit", zone: "board", controller: "A" })
      .filter(object => object.ref.id !== "seraphine" && object.exhausted);
    assert.deepEqual(counted.map(object => object.ref.id), Array.from({ length: exhaustedAllies }, (_, index) => `ally-exhausted-${index}`));
    // The expected value follows the printing. A fixed +1 implementation must
    // fail these TODOs for both 0 and 3 eligible units.
    assert.equal(engine.layers.evaluate(kernel.ref("seraphine")).might, 1 + exhaustedAllies);
  });
}
