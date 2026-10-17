import type { CardProgram } from "../../ir/index.js";

/**
 * Bullet Time, Miss Fortune (ogn-268-298) — Spell, 1 energy, no printed Power
 * (Body/Chaos, Miss Fortune Signature).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Pay any amount of :rb_rune_rainbow: to deal that much damage to all enemy
 *   units at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806 / 159.2.a) is declared as a keyword ability; the keyword
 *   registry owns its expansion (contract 3.7).
 * - The catalog records `power: null` for this printing, i.e. no printed
 *   Power requirement; it is never rewritten to 0 and the program declares no
 *   cost, exactly as the merged programs for cost-less spells do.
 * - "Pay any amount of [A] to deal that much damage ..." is a Cost within an
 *   Instruction (204.3 / 204.3.a): the printed example for this rule is Bullet
 *   Time itself. The payment is chosen "as the spell resolves"; the damage
 *   amount is the amount actually paid, so the two are one instruction: the
 *   cost and its linked effect cannot be split into an unconditional damage
 *   instruction plus a separate payment, and the payment must not be defaulted
 *   to a fixed X.
 * - "... to all enemy units at a battlefield" is a programmatic set chosen by
 *   criteria, not a target group (355.10.d / 355.10.d.1: "Kill all units at a
 *   battlefield" targets the battlefield, not the units; the units can never be
 *   chosen).
 * Status: judge-required — both needed forms are still unavailable:
 * - the merged effect.damage consumes only a Finalize-locked TargetSpec id
 *   (ctx.targets(specId)); it has no non-target set form, unlike effect.ready
 *   and effect.heal which take { kind: "query", filter }. Using a TargetSpec
 *   here would wrongly fire "becomes a target" effects (355.7, 754).
 * - "Pay any amount of [A]" needs a resolve-time, player-chosen payment
 *   primitive bound to the amount that the effect reads. The merged cost
 *   pipeline only consumes a Finalize-time plan, cost.pay-any is not a
 *   registered instruction, and no linked paid amount is exposed.
 * The damage set and the payment binding are therefore recorded in the pending
 * descriptor shape (identical to the merged Flurry of Blades program, which
 * blocks for the same missing non-target damage form) rather than approximated
 * with a fixed amount or a target group.
 */
const bulletTime = {
  canonicalCardId: "card.hash-a3cda4342389b7462e190847b72891326166dd6d3a74a0400056dbbee1371daa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两段依赖未合入：(1) 缺非目标集合的伤害形态：CR 355.10.d 规定按特征程序化选出、玩家无从选择的单位不是目标" +
    "（“Kill all units at a battlefield”只选战场、不选单位，355.10.d.1 把该例外限定为从不做选择的集合），" +
    "已合入的 effect.damage 只读取 Finalize 锁定的 TargetSpec（ctx.targets(id)），没有 effect.ready / effect.heal 那种 " +
    "{kind:'query', filter} 非目标集合分支；写 TargetSpec 会错误触发成为目标（355.7、754）。" +
    "(2)「Pay any amount of [A]」是 204.3/204.3.a 的指令内费用（该条规则以本卡为例）：金额在结算时由玩家选择且伤害量由实付额决定，" +
    "已合入原语没有任何结算期“任意数量支付并发布实付额”的形态——合并的费用管线只处理 Finalize 费用计划，" +
    "cost.pay-any 也没有注册为指令，实付额不作为链接值暴露；" +
    "把金额写死或拆成无条件伤害都属近似实现。" +
    "印刷 power:null 表示无印刷费，未改写为 0。仍缺 effect.damage 的非目标集合形态与结算期任意数量支付/链接值原语。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Pay any amount of :rb_rune_rainbow: to deal that much damage to all enemy units at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "bullet-time.pay-any-amount",
          // "Pay any amount of [A]" — a Cost within an Instruction (204.3 /
          // 204.3.a). The amount is chosen as the spell resolves and must be
          // reportable for the damage below; no merged primitive performs or
          // reports it (see judgeReason).
          op: "cost.pay-any",
          args: {
            resource: { kind: "constant", value: "power" },
            domain: { kind: "constant", value: "rainbow" },
            amount: { kind: "constant", value: "any" },
            linkKey: { kind: "constant", value: "paid" },
            prompt: { kind: "constant", value: "Pay any amount of [A]?" }
          }
        },
        {
          id: "bullet-time.damage-each-enemy-unit",
          op: "effect.damage",
          linkedTo: "bullet-time.pay-any-amount",
          args: {
            // "deal that much damage": the amount actually paid.
            amount: {
              kind: "linked-value",
              instructionId: "bullet-time.pay-any-amount",
              key: "paid"
            },
            // Non-target programmatic set (355.10.d), described with the same
            // descriptor shape the merged effect.ready / effect.heal use and
            // the merged Flurry of Blades program records.
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                // The layer engine's filter matcher reads a location-type
                // string here (layers/filter.ts: "location: battlefield").
                filter: { type: "unit", controller: "opponent", location: "battlefield" }
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default bulletTime;

