import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/masa-crashing-thunder.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import stunPrimitive from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";

const CANONICAL_ID =
  "card.hash-136c3803080e71b9a47e3adff1362584873339a31072f939e14afa55abc3ecd2";
const SOURCE_TEXT =
  "You may pay :rb_rune_order: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield. " +
  "(It doesn't deal combat damage this turn.)";

const [additionalCost, onPlay] = program.abilities;
const [stun] = onPlay.body;

const masaKernel = ({ enemyStunned = false, enemyLocation = { type: "battlefield", id: "bf-1" } } = {}) => {
  const base = world()
    .player("controller")
    .player("B")
    .unit("masa", {
      controller: "controller",
      location: { type: "base", player: "controller" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      stunned: enemyStunned,
      location: enemyLocation
    })
    .build();
  return base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("masa")
  });
};

test("ven-120-166 Masa, Crashing Thunder: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-120-166 Masa: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 缺可选追加费用原语与已付回执。
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120|cost\.sacrifice/);
});

test("ven-120-166 Masa: the optional additional cost is one Order Power (CR 356.2.b / 163.2)", () => {
  assert.equal(program.abilities.length, 2);
  // 356.2.b/356.2.b.1：被打出卡牌上的被动能力规定的可选追加费用。
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    {
      kind: "power",
      amount: { kind: "constant", value: 1 },
      allowedDomains: ["Order"]
    }
  ]);
});

test("ven-120-166 Masa: the play trigger stuns one enemy unit at a battlefield", () => {
  // 383.4.a.1：Play Effect —— card-played 时点过滤来源自身。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(onPlay.optional, false);

  assert.equal(onPlay.body.length, 1);
  assert.equal(stun.id, "masa-crashing-thunder.stun-enemy-unit");
  assert.equal(stun.op, "effect.stun");
  assert.deepEqual(stun.args.target, {
    kind: "constant",
    value: "masa-crashing-thunder.enemy-unit"
  });
  // 355.10.b："at a battlefield" 是位置限制；“an enemy unit” 是敌方单位目标。
  assert.deepEqual(stun.targets, [
    {
      id: "masa-crashing-thunder.enemy-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        location: { type: "battlefield" }
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(stun.linkedTo, undefined);
  assert.equal(instructionDefinitionsById.get("effect.stun") !== undefined, true);
});

test("ven-120-166 Masa golden: the Stun half stuns exactly one enemy unit at a battlefield", () => {
  // 424.1/424.1.a：把单位渲染为 Stunned（424.1.c 的提示文本不是第二条能力）。
  // effect.stun 的 argsSchema 接受 TargetSpec id（原语自己经 ctx.targets() 读取），
  // 所以这里把卡里声明的 target/amount 原样交给真实原语与锁定目标。
  const kernel = masaKernel().clone({ controller: "controller" });
  const run = runInstruction(
    stunPrimitive,
    { target: stun.args.target.value },
    {
      world: kernel,
      targets: { "masa-crashing-thunder.enemy-unit": [kernel.ref("enemy")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(run.events.map((event) => event.action), ["stun"]);
  assert.equal(run.result.linkedValues.stunned.count, 1);
});

test("ven-120-166 Masa golden: an already Stunned unit is not stunned again (CR 424.1.a.1)", () => {
  const kernel = masaKernel({ enemyStunned: true }).clone({ controller: "controller" });
  const run = runInstruction(
    stunPrimitive,
    { target: stun.args.target.value },
    {
      world: kernel,
      targets: { "masa-crashing-thunder.enemy-unit": [kernel.ref("enemy")] }
    }
  );

  // 选已 Stunned 的单位仍然合法，只是不会发生任何事（424.1.a.1）。
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.stunned.count, 0);
  assert.equal(run.result.linkedValues.stunned.alreadyStunned, 1);
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(run.events, []);
});

test("ven-120-166 Masa golden: a unit in a base is outside the 'at a battlefield' restriction", () => {
  // 355.10.b：位置限制在目标合法性里生效；基地单位不是合法目标。
  // 参考内核的过滤词汇按值比较 location 文字（filter 的 location: { type: "battlefield" }），
  // 所以这里用真实解释器执行卡的本体、由解释器按卡自身的 TargetSpec 过滤器重验目标：
  // 基地单位不匹配 → 目标全部失效 → 该指令 ignored（359.3.e.7）。
  const kernel = masaKernel({ enemyLocation: { type: "base", player: "B" } }).clone({
    controller: "controller"
  });
  kernel.setTargets("masa-crashing-thunder.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody(onPlay.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "ignored",
    reason: "mistargeted"
  });
  assert.equal(kernel.getObject("enemy").stunned, false);
});

test("ven-120-166 golden: the declared 1 Order Power component is payable through the cost plan", () => {
  // 已合入的 buildCostPlan 接受同一份 payments 形状（163.2 的域费用）：这里把卡里声明的
  // 分量交给费用计划，证明 1 枚 Order Power 确实作为追加费用被收集。它不证明费用已接线
  // 到卡牌打出流程，卡牌程序绑定仍未传入支付回执（见 judgeReason / test.todo）。
  const kernel = world().player("controller").build();
  const plan = buildCostPlan(kernel, {
    id: "masa-crashing-thunder",
    cost: { kind: "explicit", energy: { kind: "constant", value: 0 } },
    domains: ["Order"],
    optionalAdditional: [
      {
        id: "masa-crashing-thunder.additional-cost",
        kind: "additional",
        selected: true,
        cost: { kind: "explicit", payments: additionalCost.effect.payments }
      }
    ]
  });
  const additional = plan.components.find(
    (component) => component.id === "masa-crashing-thunder.additional-cost"
  );
  assert.equal(additional.original.energy, 0);
  assert.deepEqual(additional.original.power, [
    { amount: 1, allowedDomains: ["Order"] }
  ]);
  assert.deepEqual(
    plan.total.power.map((requirement) => [requirement.amount, requirement.allowedDomains]),
    [[1, ["Order"]]]
  );
});

test.todo(
  "ven-120-166 Masa: the optional additional cost reaches Finalize, records the paid receipt and gates " +
    "the Stun on it (CR 356.2.b / 356.4.f.1) — CardProgram static cost.additional is not yet wired into " +
    "the play Finalize plan and the play trigger context still lacks the original plan and receipt"
);

test.todo(
  "ven-120-166 Masa: the Play Effect trigger runs end to end, including the 'if you paid the additional " +
    "cost' gate and 424.1.b/424.1.c consequences for the Stunned unit — the merged trigger path still lacks " +
    "the additional-cost paid receipt"
);


test("Masa: the play trigger declares the specific additional-cost decision", () => {
  assert.deepEqual(onPlay.trigger.condition, {
    kind: "result", result: "cost.additional", id: additionalCost.effect.id
  });
});

test("Masa: a real optional-cost receipt gates Stun, including discount to zero", () => {
  for (const [selected, discounted, expected] of [[true, false, true], [false, false, false], [true, true, true]]) {
    const kernel = world().player("A", { power: ["Order"] }).unit("masa", { cardId: CANONICAL_ID }).build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("masa") });
    const plan = buildCostPlan(context, {
      id: `masa:${selected}:${discounted}`, cost: { kind: "explicit" },
      optionalAdditional: [{ id: additionalCost.effect.id, kind: "additional", selected,
        cost: { payments: additionalCost.effect.payments } }],
      ...(discounted ? { discounts: [{ id: "free-additional", component: additionalCost.effect.id,
        resource: "power", amount: { kind: "constant", value: 1 } }] } : {})
    });
    const receipt = payCostPlan(context, plan);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.additional.map(component => component.id), selected ? [additionalCost.effect.id] : []);
    assert.equal(plan.total.power.reduce((total, payment) => total + payment.amount, 0), selected && !discounted ? 1 : 0);
    assert.equal(evaluateCondition(onPlay.trigger.condition, {
      context, host: context.source.ref, cost: { plan, receipt },
      linked: context.linked.bind(context), canLookBack: () => true, isIgnored: () => false
    }), expected);
  }
});
