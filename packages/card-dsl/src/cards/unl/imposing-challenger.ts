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
 * Status: judge-required. Candidate-relative Might filtering and the program's
 * sameLocationAs target anchor still lack a production filter adapter. The merged
 * target.location machinery enumerates locations, but the card-side selector does
 * not forward an exclusion for the current battlefield. The object-moved event
 * vocabulary and Move Destination binding remain blocked (359.3.f.3).
 * Placeholder destinations/filters stay descriptive and cannot enable the card.
 */
export default {
  canonicalCardId: "card.hash-fda3e6799f2fd63235520803dbabc0e2093d7da103c78cd4af3d14b11d20c2f8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处：(1) 目标候选的 Effective Might 与宿主比较（CR 143.2.a.1）：programs/filters.ts 尚不能绑定 mightLessThan 或 sameLocationAs 目标锚点。" +
    "(2) target.location 已能枚举地点且底层支持 exclude，但 LocationSelector/LocationTargetSpec 的卡牌消费路径没有将“排除当前战场”传给候选查询（355.4/355.4.a）；不能用 different-battlefield 字符串代替。" +
    "(3) object-moved 的 EventPattern 注册词汇与事件地点捕获缺接线；action-adapter.ts 未填充 fromKind/toKind/fromLocationId/toLocationId，无法按触发那次 Move 的目的地绑定 here（449.2、359.3.f.3）。",
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
