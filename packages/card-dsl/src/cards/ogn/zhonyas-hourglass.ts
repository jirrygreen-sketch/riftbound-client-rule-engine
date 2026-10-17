import type { CardProgram } from "../../ir/index.js";

/**
 * Zhonya's Hourglass (ogn-077-298) — Gear, 2 energy, Calm.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   The next time a friendly unit would die, kill this instead. Recall that
 *   unit exhausted. (Send it to base. This isn't a move.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 811.1 / 811.1.b: [Hidden] is a keyword ability; hiding costs [A] and the
 *   facedown card gains Reaction and ignores its base cost beginning the next
 *   turn. Declared as a keyword ability for the registry to expand.
 * - 369.1 / 370.1.a.1: "The next time a friendly unit would die, kill this
 *   instead" is a Replacement Effect that replaces the killing event; the
 *   replaced event is the death itself (the kill action does not happen).
 * - 457 / 458 / 459 / 460.1: a Recall relocates a permanent to its base
 *   without being a Move; "Recall that unit exhausted" states an exception to
 *   460.1, so the recalled unit's status is set to exhausted as part of the
 *   replacement. 355.10.c: "that unit" refers to the unit intercepted by the
 *   replacement effect, so it is not a new target choice.
 *
 * Status: judge-required — the printed shape is encoded, and the merged RIFT-260
 * replacement binding now resolves the intercepted unit, but the recall half is
 * still not executable:
 * - "Recall that unit exhausted" needs the recall GameAction (457–460).
 *   effect.move accepts mode "recall" but explicitly BLOCKS it, and the merged
 *   replacement planner surfaces that same block at bind time
 *   (BlockedReplacementError, "no Recall action exists"): the frozen
 *   move-location action cannot distinguish a Recall from a Move (458.1 would
 *   wrongly fire Move triggers, 460.1 keeps statuses). Nothing is approximated.
 * - the printed "the next time" one-shot lifetime has no representation in the
 *   static replacement form bound here; RIFT-260's one-shot window lives on the
 *   replacement.event wrapper, and a card program cannot spell that wrapper's
 *   raw instead instruction body in the frozen IR (validateInstruction accepts
 *   only Expr args while the binding layer requires an instruction array) —
 *   same contract change request as ogn/the-boss.
 * - no merged consumer turns a CardProgram's replacement ability into a
 *   ReplacementRegistration (card-program binding, RIFT-257, in progress).
 * - [Hidden]'s Hide action / facedown play still lack the cost.hidden
 *   consumption path (811.1.b/811.1.c.2; the keyword expansion itself is
 *   merged, RIFT-84).
 * What is merged and executed by the golden test: the RIFT-260 planner resolves
 * "that unit" through the published { linked: "replacement.object" } selector
 * (REPLACED_EVENT_LINK) and plans the kill-this step against the gear and the
 * exhausted-status step against the intercepted unit; the golden runs those
 * planned actions for real.
 */
const zhonyasHourglass = {
  canonicalCardId: "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Recall 动作：effect.move 的 mode \"recall\" 被原语显式阻断，已合入的替代 planner（RIFT-260）在 bind 时对同一形状抛 " +
    "BlockedReplacementError（\"no Recall action exists\"；封闭 move-location 动作无法区分 Recall 与 Move，CR 457–460：458.1 会错误触发移动触发、460.1 保持状态），不能近似为普通移动。" +
    "「that unit」的绑定已解决：golden 经 RIFT-260 planner 用 { linked: \"replacement.object\" }（REPLACED_EVENT_LINK，355.10.c）把 kill-this 规划到本装备、把 exhausted 状态步骤规划到被拦截单位并真实执行规划出的动作。" +
    "整卡仍不可执行：① 印刷的 \"the next time\" 一次性期限在静态替代形状里没有表示——RIFT-260 的 one-shot 窗口只在 replacement.event wrapper 上，" +
    "而冻结 IR 拼不出该 wrapper 的原始 instead 指令体（validateInstruction 只接受 Expr 参数、绑定层要求原始指令数组），同 ogn/the-boss 的契约变更请求；" +
    "② 没有已合入的消费方把 CardProgram 的替代能力注册成 ReplacementRegistration（卡牌程序绑定 RIFT-257 进行中）；" +
    "③ [Hidden] 的 Hide 行动/背面打出仍缺 cost.hidden 消费路径（811.1.b/811.1.c.2；关键词展开本身已合入，RIFT-84）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "replacement",
      // "The next time a friendly unit would die" — the replaced event is the
      // death of a unit the controller controls.
      replaces: {
        event: "object-killed",
        filter: { type: "unit", controller: "self" }
      },
      with: [
        {
          // "kill this instead" — the merged RIFT-260 planner resolves the
          // source-object selector to the gear host and plans the kill action.
          id: "kill-this",
          op: "effect.kill",
          args: { target: { kind: "constant", value: { kind: "source" } } }
        },
        {
          // "Recall that unit exhausted." (457-460) The intercepted unit is
          // the replaced event's object, bound through the merged RIFT-260
          // selector (355.10.c: not a new target). The recall mode itself is
          // blocked at bind time (see judgeReason).
          id: "recall-dying-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { linked: "replacement.object" } },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          }
        },
        {
          // 460.1 exception stated by this card: the recalled unit is
          // exhausted (the status change belongs to the recall, not to a Move).
          // "that unit" is the same replaced-event referent (355.10.c), so the
          // selector names it instead of choosing a second unit.
          id: "exhaust-dying-unit",
          op: "effect.exhaust",
          args: { objects: { kind: "constant", value: { linked: "replacement.object" } } }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "The next time a friendly unit would die, kill this instead. Recall that unit exhausted. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default zhonyasHourglass;
