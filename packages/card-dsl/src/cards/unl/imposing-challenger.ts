import type { CardProgram } from "../../ir/index.js";

/**
 * Imposing Challenger (unl-105-219) — Unit, Body, Ionia; energy 5, Might 5.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-105-219, verbatim):
 *   When I move, you may move an enemy unit here with less Might than me to a
 *   different battlefield.
 *
 * Rules evidence (Core Rules v1.5):
 * - 421.1 / 449.1 / 449.2: a Move is defined by its Origin and Destination; the
 *   closed timing point for it is "object-moved" (events/timing-points.ts, whose
 *   payloadFields include fromKind/fromLocationId/toKind/toLocationId). 458: a
 *   Recall is not a Move and does not trigger Move abilities.
 * - 053.3 / 053.1: "here" is the Battlefield this unit is at (after its Move),
 *   "me" is the ability host.
 * - 355.5 / 355.7: "an enemy unit here" names one Game Object chosen by the
 *   ability's controller, so it is a target (TargetSpec), locked at this
 *   triggered ability's finalize (355.5.b); 355.4 / 355.4.a: the destination is
 *   the chosen other Battlefield.
 * - 383.3.a.3: "you may" appears as the first part of the effect, so the
 *   decision belongs to finalization/resolution of the triggered ability; per
 *   contract 3.9 it is written as choice.optional with the chosen instruction
 *   inside its body (never a bare choice plus linkedTo).
 * - 421.2.a / 451: this is an effect Move ("move an enemy unit"), not the
 *   Standard Move, so there is no exhaust cost; effect.move submits the frozen
 *   move-location action.
 *
 * Status: judge-required. Three merged gaps (none approximated):
 * - "with less Might than me" compares a target's Effective Might (143.2.a.1)
 *   against the host's: neither ObjectFilter nor the frozen Expr algebra offers
 *   a comparison against another object's characteristic
 *   (sfd/soraka-wanderer records the same gap). The retained filter key
 *   `mightLessThan: "self"` is a descriptive placeholder, not a consumer.
 * - "to a different battlefield" needs the set of legal Battlefields other than
 *   the unit's current location. effect.move accepts a literal LocationRef,
 *   "controller-base", or a literal option list ({ kind: "choose", options }),
 *   and no merged Expr enumerates Battlefields, so the dynamic destination is
 *   not expressible; the retained `to: "different-battlefield"` records the
 *   intended destination kind and fails closed in the primitive's schema.
 * - "here" must be the Destination of the triggering Move (the event payload's
 *   toLocationId). The merged trigger matcher reads object characteristics and
 *   event fields but has no anchor comparing a candidate's location with an
 *   event payload location, and events/action-adapter.ts does not populate the
 *   declared from/to payload fields for move-location.
 * The optional wrapper, the target spec bounds and the effect.move call shape
 * use merged contract structures only; the golden test asserts that structure and
 * the primitive-level rejection of the placeholder destination.
 */
export default {
  canonicalCardId: "card.hash-fda3e6799f2fd63235520803dbabc0e2093d7da103c78cd4af3d14b11d20c2f8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「with less Might than me」需要把候选单位的 Effective Might（143.2.a.1）与宿主比较，" +
    "冻结 IR 的 ObjectFilter / Expr 都没有「与另一对象的特征比较」的谓词（同一缺口见 sfd/soraka-wanderer），" +
    "filter 里的 mightLessThan: \"self\" 只是描述性占位键，没有已合入消费方；" +
    "(2)「to a different battlefield」需要「除当前所在战场以外的所有战场」这一动态目的地集合，" +
    "而 effect.move 的 to 只接受字面 LocationRef、\"controller-base\" 或字面 options 列表（355.4/355.4.a），" +
    "没有已合入表达式可枚举战场，to: \"different-battlefield\" 记录意图并在原语 schema 处失败关闭；" +
    "(3)「here」必须取触发那次 Move 的目的地（事件载荷 toLocationId，449.2），" +
    "合并触发匹配既没有「候选对象位置 = 事件载荷位置」的锚点，events/action-adapter.ts 也没有为 move-location 填充" +
    "timing-points.ts 声明的 from/to 载荷字段。依赖：移动时点载荷与比较谓词的接线（RIFT-90/引擎批 4）、" +
    "目标/谓词扩展。可选包装与 effect.move 调用形状只用已合入契约结构。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // “When I move”：事件对象是本卡；Recall 不算 Move（458）。
        filter: { event: "object-moved", filter: { object: "self" } }
      },
      // 383.3.a.3：“you may” 是效果开头，按契约 3.9 用 choice.optional 包住被选指令。
      optional: true,
      body: [
        {
          id: "imposing-challenger.move-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Move an enemy unit here to a different battlefield?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "imposing-challenger.move-enemy",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "imposing-challenger.enemy-here" }
                    },
                    // 动态「另一个战场」目的地（见 judgeReason 第 2 点）。
                    to: { kind: "constant", value: "different-battlefield" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  },
                  targets: [
                    {
                      id: "imposing-challenger.enemy-here",
                      filter: {
                        type: "unit",
                        zone: "board",
                        controller: "opponent",
                        // 053.3 的 “here” 锚点（contract 3.6 anchor，事件目的地缺口见第 3 点）。
                        sameLocationAs: "self",
                        // 描述性占位：目标候选需比宿主 Might 低（143.2.a.1，见 judgeReason 第 1 点）。
                        mightLessThan: "self"
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
  ],
  sourceText:
    "When I move, you may move an enemy unit here with less Might than me to a different battlefield."
} satisfies CardProgram;
