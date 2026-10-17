import type { CardProgram } from "../../ir/index.js";

/**
 * Sunken Temple (sfd-218-221) — Battlefield, Fiora precon.
 *
 * "When you conquer here with one or more [Mighty] units, you may pay
 *  {1 energy} to draw 1. (A unit is Mighty while it has 5+ might.)"
 *
 * CR v1.5 anchors:
 * - The trigger condition references Mighty units (706–709: a unit "is
 *   Mighty" while its Might is 5 or greater). The trigger fires when you
 *   conquer; the "with one or more [Mighty] units" clause is a condition on
 *   the conquering units, not on whether the draw itself is possible.
 * - "you may pay … to draw 1" = optional wrapper + pay + effect.draw (414.x).
 *   CR 205 makes the payment the resolving player's own game action (the later
 *   clause checks the action, not a paid cost), so cost.pay inside the optional
 *   body is correct here; the merged cost.pay really deducts the Energy
 *   (golden below) and effect.draw really draws.
 *
 * Status rationale (cards/README.md §2, re-reviewed 2026-10-17):
 * judge-required. The body uses the merged `cost.pay` and `effect.draw`
 * primitives. The remaining blockers are still live:
 * - the runtime "here" anchor: `here` is not a supported filter field, so
 *   programs/filters.ts throws ProgramBindingError("Unsupported filter field
 *   here") and the trigger cannot even be registered;
 * - the conquering-unit predicate: `count` ignores its `subject`, and the merged
 *   ObjectFilter/matcher has no Might threshold — layers/filter.ts silently
 *   ignores unknown keys such as `mightGte`, so any unit would be counted.
 * The trigger and payment are kept explicit and are not approximated.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有两个规则数据缺口：(1)「conquer here」需要把触发载荷中的 battlefieldId 与本卡宿主的运行时 " +
    "位置绑定；当前 EventPattern 没有 payload-location/here 锚点，静态 filter 里的 here: true 会被 " +
    "programs/filters.ts 直接以 Unsupported filter field here 拒绝，触发器实测无法注册。" +
    "(2)「one or more Mighty units」需要对本次征服的单位集合执行 Might >= 5 的计数；count 表达式不消费它的 subject，" +
    "ObjectFilter/图层匹配器也没有 Might 阈值（未知键被忽略），因此既不能命名 conquering-units，也无法只统计 Mighty 单位。" +
    "cost.pay、choice.optional 与 effect.draw 已合入并在正文中使用（golden 实测真实支付 1 Energy 并抽 1），" +
    "不把缺失的条件放宽为任意单位。",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "conquered" 是封闭事件词表（EVENT_PATTERN_TYPES）的判别值；
        // events/pipeline-match.ts 的 EVENT_NAMES 将其映射到 conquer 时点。
        // here 仍是描述性标记：programs/filters.ts 会以 unsupported filter field 拒绝它。
        filter: { event: "conquered", here: true, player: "controller" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "conquering-units",
            filter: { type: "unit", controller: "controller", mightGte: 5 }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: true,
      body: [
        {
          id: "sunken-temple.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "sunken-temple.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "sunken-temple.draw",
                  op: "effect.draw",
                  linkedTo: "sunken-temple.pay",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
