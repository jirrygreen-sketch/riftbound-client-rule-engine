import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kogmaw-caustic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl 对 engine-core 没有依赖边（engine-core 依赖 card-dsl），golden 执行按 workspace
// 布局直接加载已构建的 engine-core。
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { translateObjectFilter } = await import(new URL("programs/filters.js", engineCore));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", engineCore));
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { createProgramBinding } = await import(new URL("programs/index.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));

/** A real Board unit behind the production chain host (CR 808.1 triggers on death). */
function boardFixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("kogmaw", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 1, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { owner: "A", controller: "A", might: 3, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

const CANONICAL = "card.hash-0f5741c23c7acda9685575d52a79431b6bad15e2c75415c8ecc902943fae6cd1";
const SOURCE_TEXT =
  "[Deathknell] — Deal 4 to all units at my battlefield. (When I die, get the effect.)";

const [keyword, triggered] = program.abilities;
const [damage] = triggered.body;

test("kogmaw-caustic: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("kogmaw-caustic: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /object-killed/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /attachProgramLifecycle/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("kogmaw-caustic: the Deathknell expansion's trigger.leave op is registered", () => {
  // CR 808.1: the keyword expansion and its leave-body instruction are now both
  // present. The card still waits on the same-location target binding below.
  const deathknell = keywordDefinitionsById.get("Deathknell");
  assert.ok(deathknell, "the Deathknell KeywordDef must be registered");
  const [expanded] = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.trigger.at, "object-killed");
  assert.equal(expanded.body[0].op, "trigger.leave");
  assert.equal(instructionDefinitionsById.has("trigger.leave"), true);
});

test("kogmaw-caustic: a real chain kill queues the card's own object-killed trigger", () => {
  // 808.1.d.2: the production lifecycle now retains the source registration
  // through the suspended exit wave, so a real Kill queues the trigger.
  const f = boardFixture();
  const source = f.kernel.getObject("kogmaw");
  f.engine.pipeline.registerTrigger({
    id: "kogmaw-probe",
    source,
    controller: "A",
    spec: { at: "object-killed", filter: {} },
    body: [{ id: "kogmaw-probe.draw", op: "effect.draw", args: { amount: { kind: "constant", value: 1 } } }]
  });

  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("kogmaw") });
  assert.equal(outcome.status, "done");
  assert.deepEqual(f.engine.items.map(item => item.kind), ["triggered"]);
  // The same registration bound through the production lifecycle follows the
  // real Kill before the registration is retired.
  const g = boardFixture();
  const programAsExecutable = { ...program, status: "executable", judgeReason: undefined };
  const handle = createProgramBinding({ cardPrograms: [programAsExecutable] }).attachLifecycle(g.engine);
  g.engine.commit({ type: "kill", object: g.kernel.ref("kogmaw") });
  assert.deepEqual(g.engine.items.map(item => item.kind), ["triggered"]);
  handle.detach();
});

test("kogmaw-caustic: the production trigger translator preserves the body's sameLocationAs anchor", () => {
  assert.deepEqual(translateObjectFilter(damage.targets[0].filter), {
    type: "unit",
    sameLocationAs: "source"
  });
});

test("kogmaw-caustic: [Deathknell] + object-killed trigger on the host", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(keyword.value, undefined);

  // CR 808.1.c/808.1.d: "When I die" = 自身被消灭（429.1.a.1.b 在送入 Trash 前入链）。
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
});

test('kogmaw-caustic: "Deal 4 to all units at my battlefield" targets by source location', () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(damage.id, "kogmaw-caustic.deal-4");
  assert.equal(damage.op, "effect.damage");
  assert.deepEqual(damage.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(damage.args.target, { kind: "constant", value: "units-at-my-battlefield" });
  assert.equal(damage.linkedTo, undefined);
  assert.equal(damage.picks, undefined);

  assert.equal(damage.targets.length, 1);
  const [spec] = damage.targets;
  assert.equal(spec.id, "units-at-my-battlefield");
  // CR 808.1.d.3 + 契约 3.6: "my battlefield" 是来源的最后已知地点。
  assert.deepEqual(spec.filter, { type: "unit", sameLocationAs: "source" });
  // CR 355.10.d: "all units" 是自动选定的集合，不是目标选择。
  assert.equal(spec.selection, "all");
  assert.equal(spec.min, 0);
  assert.equal(spec.max, undefined);
});

test("kogmaw-caustic golden: the effect deals 4 to every unit at the host's battlefield", () => {
  const base = world()
    .unit("kogmaw", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("far", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  // 宿主快照是能力来源的最后已知信息（808.1.d.3）；Deathknell 的触发发生在换区之前。
  const kernel = base.clone({ sourceSnapshot: base.getObject("kogmaw") });
  kernel.setTargets("units-at-my-battlefield", [kernel.ref("ally"), kernel.ref("enemy")]);
  const killed = kernel.perform({ type: "kill", object: kernel.ref("kogmaw") });
  assert.equal(killed.status, "done");
  assert.equal(kernel.getObject("kogmaw").zone, "trash");

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["kogmaw-caustic.deal-4", "executed"]
  ]);
  assert.equal(kernel.getObject("ally").damage, 4);
  assert.equal(kernel.getObject("enemy").damage, 4);
  // 只有同一战场（bf-1）上的单位受影响。
  assert.equal(kernel.getObject("far").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage", "damage"]);
});

test("kogmaw-caustic golden: an emptied battlefield ignores the instruction (CR 359.3.e.7)", () => {
  const base = world()
    .unit("kogmaw", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("far", { owner: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("kogmaw") });
  kernel.perform({ type: "kill", object: kernel.ref("kogmaw") });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("far").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "kogmaw-caustic: Deathknell keyword expansion (808.1.d.1 死亡被替代时移出链、808.1.d.3 " +
    "换区前记录最后已知信息、object-killed 触发收集) 依赖 trigger.leave 原语、object-killed " +
    "触发收集与最后已知信息处理"
);
