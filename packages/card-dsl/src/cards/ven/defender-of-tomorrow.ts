import type { CardProgram } from "../../ir/index.js";

/**
 * CR v1.5 827.1.c.1、828.1.b.1、442.1.a：Empower 展开已合入，但 KeywordAbility
 * 与 expandProgram 仍未传递印刷费用 2 Energy + 2 [A]；不在卡侧重写关键词。
 * 两个 [A] 用两条 amount 1、allowedDomains 六域的费用需求表达（135.2.e.5.a）。
 * Ready 1 / Ready 2 的本体、费用与 empowered > 0 门控可在参考内核执行；公开
 * ObjectSnapshot 仍未声明 empowered，不能以测试内核的扩展字段宣称正式适配器完整。
 */
export default {
  canonicalCardId: "card.hash-a83f38e4a2af89564ecd6ceb9b9d1eb607e58af4d10927e697cd6eb4c95fe037",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Empower KeywordDef、effect.empower 和 827.1.c.1 的未 Empowered 比较限制已合入；" +
    "仍缺 KeywordAbility → programs/keywords 的 params.cost 传递，印刷 2 Energy + 2 [A] 无法随关键词绑定。" +
    "两个 [A] 的费用规划与支付已支持（135.2.e.5.a）。828.1.b.1 的 Ready 2 gear 已用 restriction.condition " +
    "比较 empowered > 0，参考内核可求值；公开 ObjectSnapshot 契约仍未声明 442.1.a 的 empowered，" +
    "正式适配器的状态读取尚无契约保证。不近似实现。",
  abilities: [
    {
      kind: "keyword",
      keyword: "empower"
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "defender-of-tomorrow.ready-gear",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defender-of-tomorrow.gear" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "defender-of-tomorrow.gear",
              filter: { type: "gear", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      // 828.1.b.1：通过已支持的 restriction.condition 门控，不将描述字符串当布尔值。
      restriction: {
        kind: "dependent-keyword", keyword: "empowered",
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "empowered" },
          operator: "gt", right: { kind: "constant", value: 0 }
        }
      },
      body: [
        {
          id: "defender-of-tomorrow.ready-2-gear",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defender-of-tomorrow.gears" }
            },
            amount: { kind: "constant", value: 2 }
          },
          targets: [
            {
              id: "defender-of-tomorrow.gears",
              filter: { type: "gear", zone: "board" },
              min: 2,
              max: 2,
              selection: "any"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: " +
    "(:rb_energy_2::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
    ":rb_energy_1:, :rb_exhaust:: Ready a gear.\n" +
    "[Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear."
} satisfies CardProgram;
