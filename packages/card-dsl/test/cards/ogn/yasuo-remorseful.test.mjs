import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/yasuo-remorseful.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { translateInstructionTargets, translateTriggerFilter, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/ref.js";
import { queryTargetCandidates } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL = "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8";
const SOURCE_TEXT = "When I attack, deal damage equal to my Might to an enemy unit here.";

const [attack] = program.abilities;
const hit = attack.body[0];

const probe = (location) => ({
  canonicalCardId: "card.hash-yasuo-location-probe",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "probe",
  abilities: [{
    kind: "play",
    body: [{
      id: "probe-damage",
      op: "effect.damage",
      args: {
        amount: { kind: "constant", value: 1 },
        target: { kind: "constant", value: "enemy-here" }
      },
      targets: [{
        id: "enemy-here",
        filter: { type: "unit", zone: "board", controller: "opponent" },
        ...(location === undefined ? {} : { location }),
        min: 1,
        max: 1,
        selection: "one"
      }]
    }]
  }]
});

test("ogn-076-298: identity, exact source text, pure data and judge-required status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 复核后的三处当前缺口（均有实测证据）。
  assert.match(program.judgeReason, /Unsupported filter field sameLocationAs/);
  assert.match(program.judgeReason, /invalid-location-filter|invalid-location-kind/);
  assert.match(program.judgeReason, /Expected a filter object/);
  assert.match(program.judgeReason, /TurnCombatBlockedError/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Yasuo: mandatory attack trigger fires only on the host's first attacker designation each combat", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(attack.kind, "triggered");
  assert.deepEqual(attack.trigger, {
    at: "attack-declared",
    filter: { object: "self" },
    once: "per-combat"
  });
  assert.equal(attack.optional, false);
  assert.equal(attack.body.length, 1);
});

test("Yasuo: the declared object-self trigger filter is still unbound by the production translator", () => {
  // 额外实测缺口：programs/filters.ts 的 translateTriggerFilter 只把 source /
  // role / self:true / objectId:"self" 归一化成 objectId，单独写 { object: "self" }
  // 会走 translateObjectFilter 并抛 "Expected a filter object"。
  assert.throws(
    () => translateTriggerFilter(attack.trigger.filter, "yasuo-ref", "attack-declared"),
    (error) => {
      assert.equal(String(error.message), "Expected a filter object");
      return true;
    }
  );
  // 同一意图的已合入写法会得到正确绑定，说明缺的是该拼写的适配：
  assert.deepEqual(
    translateTriggerFilter({ event: "attack-declared", filter: { source: "self" } }, "yasuo-ref", "attack-declared"),
    { event: "attack-declared", object: { objectId: "yasuo-ref" } }
  );
});

test("Yasuo: dynamic source Might damages exactly one enemy here, without artificial linking", () => {
  assert.equal(hit.op, "effect.damage");
  assert.deepEqual(hit.args.amount, { kind: "object-property", object: "source", property: "might" });
  assert.equal(hit.args.target.value, "enemy-here");
  assert.deepEqual(hit.targets, [{
    id: "enemy-here",
    filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.equal(hit.linkedTo, undefined);
  assert.equal(hit.condition, undefined);
});

test("Yasuo: the source-location filter anchor is still rejected by the production target binder (current gap)", () => {
  // 缺口 (1)：programs/filters.ts 的 translateObjectFilter 不认 sameLocationAs。
  assert.throws(
    () => translateObjectFilter({ type: "unit", sameLocationAs: "source" }),
    (error) => {
      assert.equal(String(error.message), "Unsupported filter field sameLocationAs");
      return true;
    }
  );
  // 整卡的文案会把该字段送进同一个生产绑定函数。
  assert.throws(
    () => translateInstructionTargets([hit]),
    (error) => {
      assert.equal(String(error.message), "Unsupported filter field sameLocationAs");
      return true;
    }
  );
});

test("Yasuo: the TargetSpec-level relative location selector is also rejected by the IR validator (current gap)", () => {
  // 缺口 (2)：改用 TargetSpec 级相对位置选择器也不行——ir/validation.ts 的
  // validateTarget 把非具体值当 LocationFilter 检查。
  for (const location of [
    "source-location",
    { kind: "source-location" },
    { kind: "location-of", object: "source" },
    { kind: "relative", relation: "source-location" }
  ]) {
    const result = validateCardProgram(probe(location));
    assert.equal(result.ok, false, JSON.stringify(location));
    assert.equal(
      result.issues.some((issue) => ["invalid-location-filter", "invalid-location-kind"].includes(issue.code)),
      true,
      JSON.stringify({ location, issues: result.issues })
    );
  }

  // 只有 location 类型过滤器（例如 battlefield）可以通过校验。
  assert.equal(validateCardProgram(probe({ type: "battlefield" })).ok, true);
});

test("Yasuo: the runtime location resolver does support source-location, so only the IR/binder plumbing is missing", () => {
  // engine-core/src/target/location/ref.ts 已能解析相对选择器；缺口在卡片侧的表达与生产绑定。
  const kernel = world()
    .unit("yasuo", { owner: "A", controller: "A", might: 6, location: { type: "battlefield", id: "bf1" } })
    .unit("enemy-here", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf2" } })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("yasuo"),
    sourceSnapshot: kernel.getObject("yasuo"),
    controller: "A"
  });

  assert.deepEqual(resolveLocationSelector("source-location", { context }), {
    type: "battlefield",
    id: "bf1"
  });
  const candidates = queryTargetCandidates(
    context,
    {
      id: "enemy-here",
      filter: { type: "unit", zone: "board", controller: "B" },
      location: "source-location",
      min: 1,
      max: 1,
      selection: "one"
    },
    { phase: "resolve" }
  );
  assert.deepEqual(candidates.map((ref) => ref.id), ["enemy-here"]);
});

test("Yasuo golden subeffect: damage uses current Might, not the printed six", () => {
  const initial = world().unit("yasuo", { might: 7 }).unit("enemy", { owner: "B", might: 10 }).build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("yasuo") });
  const enemy = kernel.ref("enemy");
  const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "enemy-here": [enemy] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 7);
  assert.deepEqual(run.linked.dealtTo, [{ target: enemy, amount: 7 }]);
  assert.equal(kernel.getObject("enemy").damage, 7);
  assert.equal(kernel.getObject("yasuo").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("Yasuo golden subeffect: the raw resolve-context query does not honour the anchor either", () => {
  // 进一步实测：连 bindResolveContext 暴露的 query 都不解析 sameLocationAs
  // （只有解释器内部的 queryObjects 包装会），所以两条路径都拿不到 "here" 限制。
  const kernel = world()
    .unit("yasuo", { owner: "A", controller: "A", might: 6, location: { type: "battlefield", id: "bf1" } })
    .unit("enemy-here", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf2" } })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("yasuo"),
    sourceSnapshot: kernel.getObject("yasuo"),
    controller: "A"
  });
  // The anchor is ignored, so BOTH enemies come back: the restriction is lost.
  assert.deepEqual(
    context.query({ type: "unit", controller: "B", sameLocationAs: "source" }).map((object) => object.ref.id),
    ["enemy-here", "enemy-elsewhere"]
  );
});

test("Yasuo golden subeffect: an unavailable finalized target causes ignored, not damage to another unit", () => {
  const kernel = world().unit("yasuo", { might: 6 }).unit("other-enemy", { owner: "B", might: 10 }).build();
  const run = runInstruction(damage, { amount: hit.args.amount, target: hit.args.target.value }, { world: kernel, targets: { "enemy-here": [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("other-enemy").damage, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "Yasuo: accept the relative source-location anchor in the production target binder (or the TargetSpec-level " +
    "relative location selector in the IR validator) and produce the CR 383.4.e attack-declared timing from " +
    "the real combat flow so this card's registered trigger actually enqueues"
);
