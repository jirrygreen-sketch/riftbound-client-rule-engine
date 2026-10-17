import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * dune-devourer — Core Rules v1.5; see judgeReason for the current execution gaps.
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
    "CR 356.2.b/356.4.f.1：programs/play.ts 的 translateCost 未绑定 additional；choiceObjects 只接受精确 ObjectRef，缺友方单位过滤器到非目标费用选择的绑定，以及把可选费用的决定关联到 -2 Energy 的折扣适配。通用条件解释器不会解析 optional-additional-cost-paid 字符串，不能把它当成真值；kill 费用规划及支付本身已支持。CR 809.1.c：Deflect 的 target.tax 与 Finalize 收税链路已存在，但 programs/statics.ts 的 layerFor 未映射 target.tax；同处也未映射本卡的 continuous.cost-modification，不能注册其条件折扣。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
