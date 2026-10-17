import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/maddened-marauder.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-2d06f94837d653adf51bb1fb5541dac6094ae71dd39819fa776457688cf8a87b";
const SOURCE_TEXT =
  "[Tank] (I must be assigned combat damage first.)\n" +
  "When you play me, move a unit from a battlefield to its base.";

const [keyword, triggered] = program.abilities;
const [move] = triggered.body;

/** 剥离 IR 里的目标声明，模拟 Finalize 已锁定目标后的解释器调用（契约 3.6）。 */
function withLockedTargets(body) {
  return body.map(({ targets, picks, ...rest }) => rest);
}

test("maddened-marauder: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("maddened-marauder: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /tank/i);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("maddened-marauder: the declared [Tank] keyword matches the merged KeywordDef and its continuous.combat shape", () => {
  const registered = keywordDefinitionsById.get("Tank");
  assert.ok(registered, "effects/keywords/Tank.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.equal(registered.stacking, "single");
  const [expansion] = tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.mode, "damage-assignment");
  assert.equal(expansion.effect.priority, "first");
  assert.equal(expansion.effect.damage, "lethal");
  assert.equal(expansion.effect.excludesKeyword, "Tank");
});

test("maddened-marauder: [Tank] keyword declaration and play trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "tank" });
  assert.equal(keyword.value, undefined);

  // CR 383.4.a: Play Effect = 单位 Finalize 并进入 Board 后入链。
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
});

test("maddened-marauder: move has one targeted unit and the controller's base destination", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(move.id, "maddened-marauder.move-to-base");
  assert.equal(move.op, "effect.move");
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "unit-at-a-battlefield" }
  });
  // CR 448.1/421: 这是一次 Move；457 的 Recall 是无需指令的校正移动，不适用。
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(move.args.linkKey, { kind: "constant", value: "movedUnit" });
  assert.equal(move.linkedTo, undefined);

  assert.equal(move.targets.length, 1);
  const [spec] = move.targets;
  assert.equal(spec.id, "unit-at-a-battlefield");
  // CR 355.9.a.1: "Unit" 默认指 Board 上的单位；位置限制在战场。
  assert.deepEqual(spec.filter, { type: "unit", location: "battlefield" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
  assert.equal(move.picks, undefined);
});

test("maddened-marauder golden: the chosen unit moves to its own base", () => {
  const base = world()
    .unit("marauder", { location: { type: "base", player: "A" } })
    .unit("victim", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("marauder") });
  kernel.setTargets("unit-at-a-battlefield", [kernel.ref("victim")]);

  const outcome = resolveChainBody(withLockedTargets(triggered.body), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["maddened-marauder.move-to-base", "executed"]
  ]);
  // 目的是**该单位的**控制者的 Base（107.1.a），不是本卡控制者的 Base。
  assert.deepEqual(kernel.getObject("victim").location, { type: "base", player: "B" });

  const receipt = outcome.linkedValues["maddened-marauder.move-to-base.movedUnit"];
  assert.equal(receipt.count, 1);
  assert.deepEqual(receipt.movements, [
    {
      object: { id: "victim", zoneEntryId: 1 },
      from: { type: "battlefield", id: "bf-1" },
      to: { type: "base", player: "B" }
    }
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("maddened-marauder golden: a target that left the battlefield is ignored (CR 359.3.e.5)", () => {
  const base = world()
    .unit("marauder", { location: { type: "base", player: "A" } })
    .unit("victim", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("marauder") });
  const locked = kernel.ref("victim");
  kernel.setTargets("unit-at-a-battlefield", [locked]);
  kernel.perform({ type: "kill", object: locked });

  const outcome = resolveChainBody(withLockedTargets(triggered.body), kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "maddened-marauder: [Tank] 的战斗伤害分配约束（815.1.b/.c）依赖 Tank 关键词展开与 combat 的 " +
    "continuous.combat 消费方（KeywordDef 已合入 RIFT-264，combat/base-combat-allocation.ts 仍不绑定 assignment-priority），" +
    "以及把卡牌关键词注册进该管线的程序绑定（RIFT-257）"
);
