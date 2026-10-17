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
    "CR 356.2.b/356.4.f.1：programs/play.ts 的 translateCost 仍拒绝 additional（mandatoryAdditional 链路已存在但静态卡程序不可达），cost/plan-values.ts 的 choiceObjects 只接受精确 ObjectRef，缺按友方单位过滤器生成费用选择（RIFT-358 进行中）以及可选费用决定关联折扣的条件（RIFT-359 进行中）；不能把未解释的字符串条件当成真值。cost.modify/cost.pay 与 kill 费用均已合入。CR 809.1.c：Deflect 的 target.tax 原语与 Finalize 收税链路已存在，但 Deflect 展开的 static 绑定被 programs/statics.ts 的 layerFor 拒绝（kind 无 target.tax 映射，RIFT-388/389 确认），收税仍是不可达路径。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_2: less.\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default program;
