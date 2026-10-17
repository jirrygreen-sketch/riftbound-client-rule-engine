import type { CardProgram } from "../../ir/index.js";

/**
 * Altar of Blood (unl-206-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-206-219, 逐字):
 *   "If a unit here would die during combat, its controller may pay
 *    :rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow: to heal it, exhaust it,
 *    and recall it instead."
 *
 * CR v1.5 anchors:
 * - 369.1 / 370.1.a.1: "would die … instead" is a Replacement Effect that
 *   replaces the killing event; the printed "instead" replacement is what
 *   keeps the unit alive (the heal then clears its marked damage, 419.1).
 * - 355.10.c: "it" is part of the replacement effect, so it is not a target
 *   choice; the referent is the unit the replaced event would have killed.
 * - 419.1-419.3: "heal it" clears marked damage with the merged effect.heal.
 * - 815-style keywords do not apply here; "exhaust it" is an explicit state
 *   change by the effect (415.1), which the merged effect.exhaust performs.
 * - 457-460: "recall it" is a Recall (relocated to its Base without being a
 *   Move); effect.move's `mode: "recall"` is explicitly BLOCKED, because the
 *   frozen move-location action cannot distinguish a Recall from a Move, and
 *   the primitive refuses to approximate one with the other.
 * - 163.2.b / 135.2.e.5: :rb_rune_rainbow: is Universal Power ("any Domain").
 *   The merged cost model represents three Universal Power symbols as one
 *   three-Power payment whose allowedDomains are the six duel domains.
 * - 204.3 / 204.4: "may pay … to heal/exhaust/recall instead" is a cost inside
 *   a replacement effect, decided by the unit's controller when the
 *   replacement would apply.
 *
 * Status: judge-required (re-reviewed 2026-10-17) — the replacement layer
 * is now merged, which changes the shape of the gaps rather than removing them:
 * 1. `bindReplacement` does turn a card ReplacementAbility into a pipeline
 *    registration and does expose the replaced event's object as
 *    `{ linked: "replacement.object" }` (REPLACED_EVENT_LINK), so CR 355.10.c's
 *    "it" is expressible. What the layer does not accept is this program's
 *    `choice.optional` wrapper: the planner supports only the closed GameAction
 *    opcode set and throws `Unsupported replacement opcode: choice.optional` at
 *    bind time, while the printed "may pay" must not be flattened into a bare
 *    optional node either (CR 370.2: the may-decision is the pipeline's own
 *    optional flag, and the frozen ReplacementAbility has no `optional` field).
 *    The payer is the unit's controller, and no merged planner action carries
 *    that decision.
 * 2. "during combat" needs a combat discriminator on the replaced death
 *    event; the closed timing payload exposes no "during combat" flag and the
 *    frozen Condition set cannot read one.
 * 3. the Recall is blocked (457-460); the three-rune Universal Power value is
 *    representable in the ordinary cost model but is not yet accepted by the
 *    replacement planner's payment path.
 * The golden test executes the merged halves (effect.heal clears the marked
 * damage, effect.exhaust sets the state) and binds the replacement through the
 * real pipeline to record exactly where the body stops; recall and payment
 * stay `test.todo`.
 *
 * Dependencies: replacement-body optional/payment and full-heal planning,
 * a combat-death discriminator, and the Recall action.
 */
export default {
  canonicalCardId: "card.hash-8a6701849fc591215d101121138ec91bc46da22693dc4c35b90fbfe6c36f0155",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) bindReplacement 已能注册卡牌替代，并把被替代事件的对象暴露为 " +
    "{ linked: \"replacement.object\" }（REPLACED_EVENT_LINK，355.10.c 的“it”因此可指称）；但这一版 planner 只接受封闭 GameAction 操作码，" +
    "本程序的 choice.optional 包装会在绑定期抛 Unsupported replacement opcode: choice.optional，而印刷的“may pay”也不能裸写进 with" +
    "（CR 370.2：可以/拒绝属于管线的 optional 判定，冻结的 ReplacementAbility 也没有 optional 字段）；" +
    "付款人按原文是该单位的控制者，planner 的 chooser 取自受影响对象的控制者，没有任何动作承载这笔由单位控制者支付的决定。" +
    "替代 planner 对省略 heal amount 还默认映射 amount:1，而 419.1 的不定量 Heal 应清除全部标记伤害。" +
    "(2)「during combat」需要在被替代的死亡事件上判别战斗期，封闭时点载荷没有战斗期标志，Condition 也没有读取它的路径；" +
    "(3)「recall it」是 457-460 的 Recall——effect.move 的 mode recall 被原语显式阻断（封闭 move-location 动作无法区分 Recall 与 Move，" +
    "不得用普通移动近似）；:rb_rune_rainbow:×3（Universal Power）已可在普通费用模型中用三点、六域 allowedDomains 表达，但仍未接入替代体的付款计划。已支持部分：effect.heal 与 effect.exhaust 在 golden 里用真实原语执行，" +
    "替代的绑定也在 golden 里通过真实 pipeline 验证支持的子计划。" +
    "依赖：replacement planner 可接受的替代体可选/支付形状（契约变更请求）、不定量 Heal 的完整规划、Recall 动作（457-460）与战斗死亡判别。",
  sourceText:
    "If a unit here would die during combat, its controller may pay " +
    ":rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow: to heal it, exhaust it, and recall it instead.",
  abilities: [
    {
      kind: "replacement",
      // 369.1: the replaced event is the death of a unit at this Battlefield.
      // "here" uses the contract 3.6 sameLocationAs anchor against the source
      // Battlefield; the combat discriminator is part of the judged gap.
      replaces: {
        event: "object-killed",
        filter: { type: "unit", zone: "board", sameLocationAs: "self" }
      },
      with: [
        {
          id: "altar-of-blood.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay three Runes to heal, exhaust, and recall it?" },
            body: {
              kind: "constant",
              value: [
                {
                  // The printed Universal Power cost (3 × :rb_rune_rainbow:).
                  // A numeric Power payment uses all six duel domains as its
                  // allowedDomains set, so three symbols remain three Power.
                  id: "altar-of-blood.pay",
                  op: "cost.pay",
                  args: { power: { kind: "constant", value: 3 } }
                },
                {
                  id: "altar-of-blood.heal",
                  op: "effect.heal",
                  linkedTo: "altar-of-blood.pay",
                  args: {
                    // 355.10.c: the replaced event binds "it"; there is no
                    // target choice for the unit being saved.
                    objects: {
                      kind: "constant",
                      value: { linked: "replacement.object" }
                    },
                    linkKey: { kind: "constant", value: "healed" }
                  }
                },
                {
                  // 415.1: "exhaust it" is an explicit state change; the
                  // merged effect.exhaust performs it.
                  id: "altar-of-blood.exhaust",
                  op: "effect.exhaust",
                  linkedTo: "altar-of-blood.heal",
                  args: { objects: { kind: "constant", value: { linked: "replacement.object" } } }
                },
                {
                  // 457-460: a Recall returns the permanent to its Base
                  // without being a Move; effect.move accepts mode "recall"
                  // but returns the blocked receipt (see judgeReason).
                  id: "altar-of-blood.recall",
                  op: "effect.move",
                  linkedTo: "altar-of-blood.exhaust",
                  args: {
                    // The replacement planner binds the affected unit before
                    // planning its actions. Recall remains blocked.
                    objects: { kind: "constant", value: { linked: "replacement.object" } },
                    to: { kind: "constant", value: "controller-base" },
                    mode: { kind: "constant", value: "recall" },
                    linkKey: { kind: "constant", value: "recalled" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
