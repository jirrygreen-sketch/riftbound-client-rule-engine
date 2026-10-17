import type { Ability, CardProgram } from "../../ir/index.js";

/** CR v1.5 134、143.2.c、317.2.c、809.1.c、813。-5 临时 Might 已支持，忽略目标税与领域筛选仍阻塞整卡。 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    // "Ignore [Deflect] while paying this spell's cost." — 打出本牌时的目标税忽略声明
    // （809.1.c 的强制附加费用在支付本法术费用时跳过）；消费方未合入（见 judgeReason 第 1 点）。
    kind: "static",
    effect: {
      kind: "continuous.ignore-target-tax",
      appliesTo: "self",
      tax: { kind: "constant", value: "deflect" },
      window: { kind: "constant", value: "paying-this-spells-cost" }
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Give an enemy Body unit -5 :rb_might: this turn." — 算术图层的临时 Might
        // 修正，end-of-turn 到期；continuous.might 已支持该子效果。
        id: "decree-of-insight.give-minus-5",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: -5 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "decree-of-insight.enemy-body-unit" }
        },
        targets: [
          {
            id: "decree-of-insight.enemy-body-unit",
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              // 描述性限制，不是可求值谓词："Body unit" 需要按 power 含 Body 过滤，
              // 已合入的查询消费方不读该键（见 judgeReason 第 2 点）。
              targetRestriction: "domain-body"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-f345f205e63964bf3901c9e175e8aee2a18b9ada1c14fb80568ff7dce79b66e3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 809.1.c 的目标税生产读取/忽略路径：continuous.ignore-target-tax 尚未绑定到本法术 Finalize 的 Deflect 费用计划（RIFT-360）。134 的 Body 领域还缺独立领域特征与成员谓词（RIFT-359）；ObjectSnapshot.power 是力量费用域，不能替代领域。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Ignore [Deflect] while paying this spell's cost.\n" +
    "Give an enemy Body (:rb_rune_body:) unit -5 :rb_might: this turn."
} satisfies CardProgram;
