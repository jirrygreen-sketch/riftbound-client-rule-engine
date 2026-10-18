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
 * Status: judge-required (re-verified against the merged sources, 2026-10-17). Four
 * gaps remain:
 * (1) The closed EVENT_PATTERN_TYPES vocabulary has no "object-moved" spelling even
 * though the timing point itself exists (events/timing-points.ts, producers in
 * events/action-adapter.ts), and validateTriggerSpec rejects the registration with
 * invalid-event-type. The trigger anchor itself is now the preserved `source: "self"`
 * spelling: the previous nested `object: "self"` form was silently dropped by
 * programs/filters.ts translateTriggerFilter, which would have matched every Move.
 * (2) programs/filters.ts rejects the target filter's sameLocationAs anchor
 * ("Unsupported filter field sameLocationAs"), and the candidate-relative Might
 * comparison (143.2.a.1) has no filter adapter at all — the same translator throws
 * "Unsupported filter field mightLessThan". (3) action-adapter.ts emits the
 * object-moved event without any fromKind/toKind/fromLocationId/toLocationId payload,
 * so the trigger's Destination (449.2, 359.3.f.3) is not observable. (4)
 * target.location's LocationCandidateOptions.exclude exists at the runtime seam, but
 * no card-side IR field forwards "a different battlefield" (355.4/355.4.a), so the
 * card keeps a descriptive destination instead of offering the illegal current
 * battlefield.
 */
export default {
  canonicalCardId: "card.hash-fda3e6799f2fd63235520803dbabc0e2093d7da103c78cd4af3d14b11d20c2f8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺四处（2026-10-17 按当前 HEAD 复核，均不近似实现）：" +
    "(1) 封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）没有 object-moved 拼写，validateTriggerSpec 以 invalid-event-type 拒绝本卡订阅；" +
    "时点本身存在于 timing-points.ts，缺的是注册词汇。" +
    "触发锚点已改用被 translateTriggerFilter 保留的 source:\"self\"：原嵌套 object:\"self\" 被静默丢弃为 { event: \"object-moved\" }，会匹配任意单位的移动。" +
    "(2) 目标候选的 Effective Might 与宿主比较（CR 143.2.a.1）：programs/filters.ts 的 translateObjectFilter 对 mightLessThan 抛 " +
    "ProgramBindingError（Unsupported filter field），sameLocationAs 锚点同样被拒，目标因此无法进入生产 Finalize。" +
    "(3) action-adapter.ts 的 object-moved 发射不带 fromKind/toKind/fromLocationId/toLocationId，无法按触发那次 Move 的目的地绑定 here（449.2、359.3.f.3）。" +
    "(4) target.location 的 LocationCandidateOptions.exclude 存在于运行期候选接口，但没有卡牌 IR 字段把「排除当前战场」传给它（355.4/355.4.a）；" +
    "为不提供非法候选，目的地保持描述性 different-battlefield 而不是改成会移动回原战场的 LocationTargetSpec。" +
    "choice.optional 的拒绝分支与 effect.move 本体已有执行证据（golden）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        // “When I move”：事件对象是本卡；Recall 不算 Move（458）。
        // 锚点写作 source: "self"：translateTriggerFilter 会把它转成宿主 object
        // 过滤器；嵌套 object: "self" 会被静默丢弃成空过滤器（匹配任意单位）。
        filter: { event: "object-moved", filter: { source: "self" } }
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
