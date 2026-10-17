import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * ekko-ingenious — Core Rules v1.5; see judgeReason for the current execution gaps.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "play",
    cost: {
      kind: "additional-cost",
      optional: false,
      payments: [
        {
          kind: "return-to-hand",
          choice: {
            id: "ekko-ingenious.returned-unit",
            // 费用中的选择不是目标（355.10.c）：非目标 PickSpec。
            options: ["friendly-unit-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "unit", controller: "controller", zone: "board" }
          }
        }
      ]
    },
    // 除附加费用与 Ganking 外没有其他效果正文。
    body: []
  }
];

const program = {
  canonicalCardId:
    "card.hash-4e3817bb5cbd6b0566c6696ba86ac4b5b31ef599a37c2c9b8a3254e0c9e4665b",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "CR 356.2/355.10.c：programs/play.ts 的 translateCost 仍拒绝 additional-cost，缺 mandatory additional 费用绑定" +
    "（mandatoryAdditional 链路已存在但静态卡程序不可达）；cost/plan-values.ts 的 readCost 缺 return-to-hand 付款种类，" +
    "choiceObjects 只接受精确引用，缺按友方单位过滤的非目标费用选择（RIFT-358 进行中）。" +
    "普通 effect.zone 回手不能代替打出时收取费用。CR 810.1.b：Ganking 展开把 permission 写成字符串字段，" +
    "statics 原样注册后 layers/rules/query.ts 的 movement() 只读取 permission.routes；缺该静态形状的规范化。" +
    "continuous.movement 原语与 zones/movement.ts 消费路径本身已存在。",
  abilities,
  sourceText:
    "As an additional cost to play me, return a friendly unit to its owner's hand.\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
