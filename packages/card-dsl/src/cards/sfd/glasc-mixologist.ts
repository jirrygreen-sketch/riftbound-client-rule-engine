import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Glasc Mixologist (sfd-165-221) — Unit, 5 energy + 1 Order power, Might 5, tag Zaun.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-165-221):
 *   [Deathknell] — You may play a unit with cost no more than :rb_energy_3: and
 *   no more than :rb_rune_rainbow: from your trash, ignoring its cost.
 *   (When I die, get the effect.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 808 / 808.1.c: [Deathknell] is a triggered-ability keyword, functionally
 *   "When I die, [Effect]" on the object-killed timing point (808.1.d,
 *   429.1.a.1.b). Declared as a KeywordAbility with the printed [Effect]
 *   body, matching the merged Unsung Hero (sfd-167-221) shape.
 * - "you may" is an optional effect chosen by the ability's controller as the
 *   ability resolves (355.1 / 371.2 for replacements; contract 3.9 wraps the
 *   whole chosen body in choice.optional).
 * - "play a unit ... from your trash" is the effect Play of an existing object
 *   from a non-Board zone (420.3, 355.10.a: "Recycle a unit from your trash"
 *   is the surveyed example of naming a card in another zone). The card in
 *   the trash is public, so the choice is a Target (355.7, 355.9.a).
 * - "ignoring its cost" sets the base Energy and base Power cost of the played
 *   card to zero (356.1.b, 356.1.b.1); "cost no more than [3] and no more than
 *   [A]" is the qualifying cost ceiling the played card must satisfy.
 *
 * Status: judge-required (re-checked 2026-10-17) — three current gaps, none approximated:
 * - the cost ceiling ("no more than :rb_energy_3: and no more than
 *   :rb_rune_rainbow:") needs a printed-cost comparison: the frozen
 *   ObjectFilter has no cost predicate, the merged engine filters ignore
 *   unknown keys, and the production binder (programs/filters.ts) fails
 *   closed on descriptive keys instead of enforcing a ceiling.
 * - "[A] Universal Power" (163.2.b) is not representable by the closed Domain
 *   type / gain-power action; effect.resources states that it "remains
 *   unsupported, never approximated by a chosen domain". A cost plan can spell
 *   the Power payment as all six allowedDomains, but that is not the ceiling
 *   comparison the printed text asks for.
 * - the ignore-cost play needs a FinalizedCostPlan produced from the chosen
 *   card's printed cost: effect.play requires an already-finalized plan and
 *   never derives printed costs. cost/cost-plan.ts can express ignore-base
 *   (356.1.b), but no card-program → selected-object cost-plan wiring exists,
 *   and the plan cannot be built for a not-yet-chosen object.
 * The Golden test executes the merged effect.play primitive with a supplied
 * ignored-cost plan against a Finalize-locked trash unit; the merged
 * [Deathknell] keyword registration is present but its expansion body still
 * references the unregistered trigger.leave opcode, and this card's own trigger
 * body cannot bind because translateObjectFilter rejects the descriptive
 * costEnergyLte/costPowerLte keys. RIFT-358 (ordered zone picks) and RIFT-359
 * (condition predicates) are merged and do not close any of these gaps.
 * Dependencies: a printed-cost predicate for target filters, selected-object
 * cost-plan wiring, the contract change for Universal Power, and the
 * trigger.leave opcode.
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "deathknell"
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true, cause: "kill", destination: "trash" }
    },
    optional: false,
    body: [
      {
        id: "glasc-mixologist.may-play",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a unit from your trash, ignoring its cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "glasc-mixologist.play-unit",
                op: "effect.play",
                args: {
                  target: { kind: "constant", value: "glasc-mixologist.unit-in-trash" },
                  // The effect states no play location, so the normal play
                  // procedure picks a valid location (355.2 / 420.3.b.1): no
                  // location argument is authored here.
                  // 356.1.b.1 ignore-cost means a zero base Energy/Power plan.
                  cost: {
                    kind: "constant",
                    value: { finalized: true, energy: 0, power: [], xp: 0 }
                  },
                  linkKey: { kind: "constant", value: "played" }
                },
                targets: [
                  {
                    id: "glasc-mixologist.unit-in-trash",
                    // Descriptive ceilings only: printed Energy <= 3 and printed
                    // Power <= 1 rainbow (163.2.b / 356.1.b). No merged filter
                    // evaluates these keys, so they must not be treated as a
                    // working restriction (see judgeReason).
                    filter: {
                      zone: "trash",
                      type: "unit",
                      owner: "controller",
                      costEnergyLte: 3,
                      costPowerLte: 1
                    },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-49233f9871e411cf4226ae402da04bca7d8cca5f0371c84fbcf23879c16ef347",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口（复核 2026-10-17）：(1)「cost no more than :rb_energy_3: and no more than :rb_rune_rainbow:」需要印刷费用上限比较，" +
    "冻结 ObjectFilter 没有费用谓词，生产绑定 translateObjectFilter 对 costEnergyLte/costPowerLte 描述性键直接 fail closed——" +
    "两者都不表达上限（RIFT-90 或契约变更），写成过滤器会让任意垃圾场单位合法；" +
    "实测本卡正文的 target 在 triggerRegistrations 里即被 translateObjectFilter 拒绝（\"Unsupported filter field costEnergyLte\"），触发因此无法注册。" +
    "(2)「:rb_rune_rainbow:」是 163.2.b 的 Universal Power：费用计划可按全部六域 allowedDomains 表示 Power 支付，" +
    "但 gain-power / effect.resources 与封闭 Domain 类型不表达 Universal Power（effect.resources 明确记录其 unsupported），绝不写成具名域；" +
    "(3)「ignoring its cost」需要费用管线生成 finalized plan（356.1.b.1 把 base Energy/Power 置零），" +
    "effect.play 只接受已完成 finalize 的计划、从不推导印刷费用，当前没有从已选垃圾场单位生成 ignore-base 计划的 CardProgram 接线。" +
    "[Deathknell] KeywordDef 已注册，但其展开体引用的 trigger.leave 原语仍未注册（instructions registry 无此 opcode）；" +
    "golden 用 effect.play + 显式零费计划对锁定目标真实执行（含接受/拒绝/失效边界）。" +
    "RIFT-358 的有序 picks 与 RIFT-359 的条件谓词均已合入，不关闭以上任何一项。" +
    "依赖：目标过滤的印刷费用谓词、trigger.leave、已选对象费用计划接线与 Universal Power 的契约变更请求。",
  abilities,
  sourceText:
    "[Deathknell] — You may play a unit with cost no more than :rb_energy_3: and no more than :rb_rune_rainbow: from your trash, ignoring its cost. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
