import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/dune-devourer.js";
import Deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CANONICAL = "card.hash-f33da6b768e700ee188122bbd6f6aad4f17db64d49c416a3c437ddb6d98ad07b";

test("rad-125-167 Dune Devourer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("cost.modify"), true);
  assert.equal(program.judgeReason.includes("Deflect"), true);
  assert.equal(
    program.sourceText,
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
      "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
  );
});

test("rad-125-167 Dune Devourer: [Deflect] 声明 + 可选附加费用 + 条件折扣", () => {
  assert.equal(program.abilities.length, 3);
  const [deflect, play, discount] = program.abilities;

  // [Deflect]（809）由 effects/keywords/Deflect.ts 展开为 target.tax。
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(Deflect.keyword, "Deflect");
  assert.equal(Deflect.valued, true);

  // "You may kill a friendly unit as an additional cost to play me"：204.2 附加费用；
  // 355.10.c 明确这类"作为附加费用消灭"不指定目标 → PickSpec 而非 TargetSpec。
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body, []);
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.choice, {
    id: "dune-devourer.friendly-unit",
    options: ["friendly-unit-you-control"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    owner: "controller"
  });
  assert.equal(payment.target, undefined);

  // "If you do, I cost 2 less"：356.4.f.1 的条件折扣（可选附加费用被"决定支付"即成立）。
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -2 });
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.condition.kind, "expression");
  assert.equal(
    discount.condition.value.value,
    "optional-additional-cost-paid:kill-a-friendly-unit"
  );
});

test("rad-125-167 Dune Devourer: [Deflect] 展开本体可校验，但卡牌侧不重复实现", () => {
  const expanded = Deflect.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "target.tax");
  // 卡牌程序只写 keyword 声明；展开结果不属于本文件的数据。
  assert.equal(program.abilities.filter(ability => ability.kind === "static" && ability.effect.kind === "target.tax").length, 0);
});

test.todo(
  "rad-125-167 Dune Devourer: 356.2.b/356.4.f.1 的可选附加费用 \"may kill a friendly unit\" 与" +
    "\"if you do, I cost 2 less\" 需要 cost.modify/cost.additional 指令与 CardProgram→CostPlanInput 编译器" +
    "把它接进链在 Finalize 生成的费用计划（依赖 RIFT-89）"
);

test.todo(
  "rad-125-167 Dune Devourer: [Deflect] 的 809.1.c 目标追加费用依赖 target.tax 与" +
    "cost.pay 的无限制域 Power 支付（RIFT-90/RIFT-89），当前 target-plan 的 taxAdapter 只在生产链" +
    "Finalize 内可用，卡牌程序无法自证可执行"
);
