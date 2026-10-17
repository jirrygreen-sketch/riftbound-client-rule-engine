import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ambessa-respected-and-feared.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd";
const SOURCE_TEXT =
  "[Empower] :rb_energy_1::rb_rune_order::rb_rune_order: " +
  "(:rb_energy_1::rb_rune_order::rb_rune_order:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Assault 2]. (+2 :rb_might: while I'm an attacker.)\n" +
  "[Empowered][>] When I attack, kill an enemy unit here with less Might than me.";

const [empower, assaultGrant, attackTrigger] = program.abilities;
const [killWeaker] = attackTrigger.body;

const ambessaKernel = (enemyMight) => {
  const base = world()
    .player("controller")
    .unit("ambessa", {
      controller: "A",
      might: 5,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      might: enemyMight,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("far-enemy", {
      owner: "B",
      controller: "B",
      might: 1,
      location: { type: "battlefield", id: "bf-2" }
    })
    .build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("ambessa") });
  kernel.setTargets("ambessa.enemy-unit-here", [kernel.ref("enemy")]);
  return kernel;
};

test("ven-136-166 Ambessa, Respected and Feared: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-136-166 Ambessa: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // 复核后的 judgeReason 只保留 Empower/Empowered 这一条未解决依赖：
  // continuous.grant-keyword 已随 RIFT-258 合入，旧的“没有注册/求值原语”已删除。
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.doesNotMatch(program.judgeReason, /没有注册\/求值原语/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-136-166 Ambessa: [Empower] plus the Empowered [Assault 2] grant", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 复核证据：授予用的原语本身已合入（缺的是 Empowered 门控）。
  // 807.1.c: Assault 2 is a valued keyword whose expansion is merged; the card
  // only declares the 828.1.b.1 dependent grant of that keyword.
  assert.ok(keywordDefinitionsById.get("Assault"), "the Assault KeywordDef is merged");
  assert.equal(assaultGrant.kind, "static");
  assert.equal(assaultGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(assaultGrant.effect.keyword, "assault");
  assert.deepEqual(assaultGrant.effect.value, { kind: "constant", value: 2 });
  assert.equal(assaultGrant.condition.kind, "compare");
  assert.deepEqual(assaultGrant.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empoweredCount"
  });
  assert.equal(assaultGrant.condition.operator, "gte");
  assert.deepEqual(assaultGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-136-166 Ambessa: the merged grant primitive really registers the Assault 2 grant", () => {
  // 828.1.b.1 的门控仍未实现，但授予原语本身可执行：按程序里的静态效果形状
  // 真实执行一次，断言 ability 层注册的 keyword/keywordValue（Assault 2 = 807.1.c）。
  const kernel = world()
    .unit("ambessa", { types: ["champion"], zone: "board", owner: "A", controller: "A" })
    .build();
  // appliesTo: "self" 绑定的是能力宿主（ResolveContext.source），所以要按
  // clone({ sourceSnapshot }) 绑定来源，与其他卡 golden 的做法一致。
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ambessa") });
  const body = [{
    id: "ambessa.grant-assault",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: assaultGrant.effect.keyword },
      value: assaultGrant.effect.value,
      // 828.1.b.1 的“我获得”= 授予宿主自身：契约 3.6 的 self 选择器。
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "ability");
  assert.equal(context.continuousEffects[0].effect.effect.keyword, "assault");
  assert.equal(context.continuousEffects[0].effect.effect.keywordValue, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "permanent" });
});

test("ven-136-166 Ambessa: the Empowered attack trigger and its Might-comparison kill", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" },
    empowered: true
  });
  assert.equal(attackTrigger.optional, false);

  assert.equal(killWeaker.id, "ambessa.kill-weaker-enemy-here");
  assert.equal(killWeaker.op, "effect.kill");
  assert.deepEqual(killWeaker.args.target, {
    kind: "constant",
    value: "ambessa.enemy-unit-here"
  });
  assert.equal(killWeaker.targets.length, 1);
  assert.deepEqual(killWeaker.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.equal(killWeaker.targets[0].selection, "one");
  // “with less Might than me”: target Might < source Might, evaluated at
  // resolution (contract 3.6 evaluate timing).
  assert.deepEqual(killWeaker.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { target: "ambessa.enemy-unit-here" },
      property: "might"
    },
    operator: "lt",
    right: { kind: "object-property", object: "self", property: "might" }
  });
});

test("ven-136-166: the descriptive Empowered trigger gate is rejected by the strict validator", () => {
  const result = validateTriggerSpec(attackTrigger.trigger);
  assert.equal(result.ok, false);
  const codes = new Set(result.issues.map(issue => issue.code));
  assert.ok(codes.has("unknown-field"), JSON.stringify([...codes]));
});

test("ven-136-166 golden: the attack kill destroys a weaker enemy unit here", () => {
  const body = attackTrigger.body.map(({ targets, ...rest }) => rest);
  const kernel = ambessaKernel(3);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["ambessa.kill-weaker-enemy-here", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").zone, "trash");
  // An enemy at another battlefield is never affected.
  assert.equal(kernel.getObject("far-enemy").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("ven-136-166 golden: equal or greater Might leaves the enemy unit alone (skipped, not mistargeted)", () => {
  const body = attackTrigger.body.map(({ targets, ...rest }) => rest);
  for (const enemyMight of [5, 7]) {
    const kernel = ambessaKernel(enemyMight);
    const outcome = runAbilityBody(body, kernel);
    assert.equal(outcome.status, "partial", `might=${enemyMight}`);
    assert.deepEqual(
      outcome.results.map(entry => [entry.result.status, entry.result.reason]),
      [["negated", "skipped"]],
      `might=${enemyMight}`
    );
    assert.equal(kernel.getObject("enemy").zone, "board", `might=${enemyMight}`);
    assert.deepEqual(outcome.events, [], `might=${enemyMight}`);
  }
});

test.todo(
  "ven-136-166 Ambessa: [Empower] expansion (827.1.c.1: 1 Energy + 2 Order Power, 'use only if " +
    "not Empowered') needs an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-136-166 Ambessa: both [Empowered][>] dependent abilities (828.1.b.1) need an Empowered " +
    "status predicate, including for the Assault 2 grant (RIFT-87)"
);

test.todo(
  "ven-136-166 Ambessa: the Empower/Empowered KeywordDefs and the 442.1.a Empowered status " +
    "predicate are pending — until they land, 827.1.c.1's activation and the 828.1.b.1 gates " +
    "cannot expand (see judgeReason)"
);
