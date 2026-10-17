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
 *
 * Status rationale (cards/README.md §2): judge-required. The draw body now uses
 * the merged `cost.pay` and `effect.draw` primitives. The remaining blockers are
 * the runtime "here" anchor on the conquer event and a count/query predicate
 * that names the conquering Mighty units (Might >= 5) without broadening the
 * condition to arbitrary units. The trigger and payment are kept explicit and
 * are not approximated.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有两个规则数据缺口：(1)「conquer here」需要把触发载荷中的 battlefieldId 与本卡宿主的运行时 " +
    "位置绑定；当前 EventPattern 没有 payload-location/here 锚点，静态 filter 只能保留描述性 here 标记。" +
    "(2)「one or more Mighty units」需要对本次征服的单位集合执行 Might >= 5 的计数；当前 count/query 词汇既不能命名 " +
    "conquering-units，也没有 is-mighty/mightGte 谓词。cost.pay、choice.optional 与 effect.draw 已合入并在正文中使用，" +
    "不把缺失的条件放宽为任意单位。",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" },
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
