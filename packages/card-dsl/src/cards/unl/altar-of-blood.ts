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
 *   The frozen Domain set and `cost.pay` have no executable Universal Power
 *   value; the neighbouring merged program ven/matriarch-of-war records the
 *   same gap with a descriptive "rainbow" spelling.
 * - 204.3 / 204.4: "may pay … to heal/exhaust/recall instead" is a cost inside
 *   a replacement effect, decided by the unit's controller when the
 *   replacement would apply.
 *
 * Status: judge-required — three independent gaps, none approximated:
 * 1. no merged path turns a CardProgram's ReplacementAbility into a
 *    ReplacementRegistration (the event pipeline takes caller-supplied
 *    matchers; nothing reads `replaces`/`with`), and no merged selector names
 *    the replaced event's unit (its controller must also make the payment
 *    decision, per the printed "its controller").
 * 2. "during combat" needs a combat discriminator on the replaced death
 *    event; the closed timing payload exposes no "during combat" flag and the
 *    frozen Condition set cannot read one.
 * 3. the Recall is blocked (457-460) and the three-rune Universal Power
 *    payment has no executable value under the frozen Domain/cost model.
 * The golden test executes the merged halves (effect.heal clears the marked
 * damage, effect.exhaust sets the state) with the replacement's unit locked,
 * exactly as the merged sfd/soraka-wanderer golden does; recall, payment and
 * registration stay `test.todo`.
 *
 * Dependencies: engine batch 4 replacement registration with a replaced-event
 * object selector (contract change request), the Recall action (RIFT-75/91
 * follow-up, `effect.move` blockedReason), and Universal Power payment
 * (RIFT-89 cost plan).
 */
export default {
  canonicalCardId: "card.hash-8a6701849fc591215d101121138ec91bc46da22693dc4c35b90fbfe6c36f0155",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 卡牌级 ReplacementAbility 没有注册路径：事件管线只接受调用方提供的动作匹配器，" +
    "没有任何已合入路径读取 CardProgram 的 replaces/with，也没有选择符能指向“被替代事件中的单位”（该单位按 355.10.c 不是目标，" +
    "且“its controller may pay”需要把该单位的控制者绑定成抉择者）；(2)「during combat」需要在被替代的死亡事件上判别战斗期，" +
    "封闭时点载荷没有战斗期标志，Condition 也没有读取它的路径；(3)「recall it」是 457-460 的 Recall——effect.move 的 mode \"recall\" "+
    "被原语显式阻断（封闭 move-location 动作无法区分 Recall 与 Move，不得用普通移动近似），而 " +
    ":rb_rune_rainbow:×3 是 163.2.b/135.2.e.5 的 Universal Power，封闭 Domain 集合与 cost.pay 没有可执行的任意域 Power 值" +
    "（同 ven/matriarch-of-war 的缺口）。已支持部分：effect.heal 与 effect.exhaust 在 golden 里用真实原语执行。" +
    "依赖：引擎批 4 的替代注册与事件对象选择符、Recall 动作（RIFT-75/91 后续）、RIFT-89 的费用计划。",
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
                  // "rainbow" is the merged descriptive spelling; the frozen
                  // cost model has no executable Universal Power value (see
                  // judgeReason).
                  id: "altar-of-blood.pay",
                  op: "cost.pay",
                  args: { power: { kind: "constant", value: ["rainbow", "rainbow", "rainbow"] } }
                },
                {
                  id: "altar-of-blood.heal",
                  op: "effect.heal",
                  linkedTo: "altar-of-blood.pay",
                  args: {
                    // 355.10.c: the referent is the unit the replaced event
                    // would have killed; the declarative TargetSpec below names
                    // it without claiming a replacement-time target choice.
                    objects: {
                      kind: "constant",
                      value: { kind: "target", id: "altar-of-blood.dying-unit" }
                    },
                    linkKey: { kind: "constant", value: "healed" }
                  },
                  targets: [
                    {
                      id: "altar-of-blood.dying-unit",
                      filter: { type: "unit", zone: "board", sameLocationAs: "self" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // 415.1: "exhaust it" is an explicit state change; the
                  // merged effect.exhaust performs it.
                  id: "altar-of-blood.exhaust",
                  op: "effect.exhaust",
                  linkedTo: "altar-of-blood.heal",
                  args: { target: { kind: "constant", value: "altar-of-blood.dying-unit" } }
                },
                {
                  // 457-460: a Recall returns the permanent to its Base
                  // without being a Move; effect.move accepts mode "recall"
                  // but returns the blocked receipt (see judgeReason).
                  id: "altar-of-blood.recall",
                  op: "effect.move",
                  linkedTo: "altar-of-blood.exhaust",
                  args: {
                    // effect.move reads its object selection as
                    // `{ target: <TargetSpec id> }`; the referent is the unit
                    // the replaced event would have killed (355.10.c).
                    objects: { kind: "constant", value: { target: "altar-of-blood.dying-unit" } },
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
