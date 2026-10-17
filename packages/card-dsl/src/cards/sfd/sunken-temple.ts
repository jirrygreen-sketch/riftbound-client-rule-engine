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
 * Status rationale (cards/README.md §2): judge-required. Three current gaps:
 * 1. "here" has no evaluable anchor. The conquer timing point is emitted by
 *    the merged scoring flow with the battlefield only as a payload detail
 *    (details.battlefieldId); a static filter cannot read its own host's
 *    runtime location, and the `here: true` placeholder is rejected by
 *    assertTriggerSpec (EventPattern allows event/type/kind/object/source/
 *    target/player/fromZone/toZone/amount/details only).
 * 2. "with one or more [Mighty] units" is not evaluable. The Mighty keyword
 *    definition is merged (effects/keywords/Mighty.ts, CR 706-711), but the
 *    trigger condition's count/query path has no Might predicate: neither
 *    layers/filter.ts matchesObjectFilter nor the interpreter's count subject
 *    understands `mightGte`/is-mighty, and unknown filter keys are ignored by
 *    both the merged matcher and the reference kernel — so the declared
 *    condition would count every unit. The conquering-unit set is also not a
 *    vocabulary the count expression can name.
 * 3. "you may pay :rb_energy_1:" has no registered `cost.pay` primitive
 *    (effects/instructions has effect.* only); the printed payment cannot be
 *    executed today.
 * effect.draw and choice.optional are merged; the intended shape below is kept
 * for review without approximating the missing parts.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口：(1)「here」没有可求值的锚点——conquer 已由 scoring 流程发出，但战场只作为载荷 details.battlefieldId 携带，静态 filter 读不到宿主运行时的地点身份，程序里的 here=true 是占位键，assertTriggerSpec 会以 unknown-field 拒绝它（RIFT-120 的事件载荷选择器）。" +
    "(2)「with one or more [Mighty] units」不可求值——Mighty 关键词展开（effects/keywords/Mighty.ts，CR 706–711）已合入，但触发条件的 count/查询路径没有 Might 谓词：layers/filter.ts 的 matchesObjectFilter 与解释器的 count subject 都不认识 mightGte/is-mighty，未知过滤键会被合并匹配器与参考内核静默忽略，该条件会按任意单位计数；conquering-units 也不是 count 表达式可命名的集合。" +
    "(3)「you may pay :rb_energy_1:」没有已注册的 cost.pay 原语（effects/instructions 只有 effect.*），印刷费用无法执行（RIFT-261）。effect.draw 与 choice.optional 已合入；不近似实现（不把条件放宽成任意单位、不把费用写成免费抽牌）。",
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
                  args: { energy: { kind: "constant", value: 1 } }
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
