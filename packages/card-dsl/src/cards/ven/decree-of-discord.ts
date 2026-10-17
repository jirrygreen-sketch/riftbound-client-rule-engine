import type { CardProgram } from "../../ir/index.js";

/** CR v1.5 127.1、134、355.11/355.13。领域与力量费用不同；整组 Might 限制不可降格为逐对象限制。 */
const decreeOfDiscord = {
  canonicalCardId: "card.hash-4691711da635261037a803f4f36b852363c66f425acc01fe7259b51e4045a69e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "355.11 的 total Might <= 5 分组目标约束仍缺总和谓词及 355.11.b/355.11.b.1 在结算时选择最大合法子集的路径；target-plan 的 group 标记本身不执行该检查。134 的 Order 领域仍缺独立领域特征与成员谓词（RIFT-359）；ObjectSnapshot.power 是力量费用域，不能替代卡牌领域，power:null 的 Order 单位也必须匹配。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Return any number of enemy Order units … to their owners' hands"：
          // 被点名的单位是目标（355.7/355.9.a.1），any number 可为零（355.13）。
          id: "decree-of-discord.return-units",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "decree-of-discord.enemy-order-units" },
            to: { kind: "constant", value: "hand" }
          },
          // 355.13：合法选择零个时不执行该动作，避免把空集合当失效目标。
          condition: {
            kind: "compare",
            left: { kind: "count", subject: "objects", filter: { object: { target: "decree-of-discord.enemy-order-units" } } },
            operator: "gt", right: { kind: "constant", value: 0 }
          },
          targets: [
            {
              id: "decree-of-discord.enemy-order-units",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                // 134 的领域需独立特征，不能用力量费用 power 替代。
                targetRestriction: "domain-order"
              },
              min: 0,
              max: null,
              selection: "any",
              // 355.11 的分组约束标记：整组合计 Might ≤ 5（与 rad/scorched-earth 的
              // group 标记同一形状）。该字段当前没有消费方，见 judgeReason 第 1 点。
              group: true
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Return any number of enemy Order (:rb_rune_order:) units with total Might 5 or less to their owners' hands."
} satisfies CardProgram;

export default decreeOfDiscord;
