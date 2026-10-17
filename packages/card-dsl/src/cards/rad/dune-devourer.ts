import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dune Devourer — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "play",
    cost: {
      kind: "additional",
      optional: true,
      // "You may kill a friendly unit": 355.10.c —— 附加费用中的对象不是目标。
      payments: [
        {
          kind: "kill",
          choice: {
            id: "dune-devourer.friendly-unit",
            options: ["friendly-unit-you-control"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { zone: "board", type: "unit", controller: "controller" }
          }
        }
      ]
    },
    body: []
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "self",
      amount: { kind: "constant", value: -2 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "optional-additional-cost-paid:kill-a-friendly-unit" }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-f33da6b768e700ee188122bbd6f6aad4f17db64d49c416a3c437ddb6d98ad07b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "CR 356.2.b/356.4.f.1：费用计划本身已支持 optionalAdditional、PickSpec 的 kill 选择与支付，但 programs/play.ts 的 translateCost 对本卡的 kind: \"additional\" / optional 字段实测以 \"Unsupported play cost field optional\" fail-closed，" +
    "没有把友方单位过滤器解析成 Finalize 时的非目标费用选择，也没有把支付决定接到 -2 Energy 折扣。通用条件解释器不会把 optional-additional-cost-paid 描述字符串当成费用回执；不能把它当成真值。" +
    "CR 809.1.c：Deflect.expand 已合入 target.tax，TargetTaxAdapter 与 Finalize 收税链路也已合入，但 programs/statics.ts 的 layerFor 实测拒绝 Static ability kind target.tax；同一 binder 也拒绝本卡 continuous.cost-modification，因而两个静态效果都没有 CardProgram → 图层/费用消费接线。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
