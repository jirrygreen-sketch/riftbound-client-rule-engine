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
 * Status: judge-required (re-checked 2026-10-17). Three current gaps, each
 * measured against merged source, and nothing here is approximated:
 *
 * 1. "Recall that unit" needs a Recall GameAction (CR 457 / 458 / 459 / 460.1).
 *    effect.move accepts mode "recall" but explicitly BLOCKS it (returns
 *    negated/impossible with blockedReason "Recall requires an action distinct
 *    from Move"), and the merged replacement planner refuses the same shape at
 *    bind time: bindReplacement plans the body once while binding and throws
 *    BlockedReplacementError "effect.move mode 'recall' is blocked (CR 457-460):
 *    no Recall action exists". The frozen move-location action cannot tell a
 *    Recall from a Move, so 458.1 would wrongly fire Move triggers and 460.1
 *    would not be honoured; an ordinary Move is not an acceptable substitute.
 * 2. The printed "the next time" one-shot lifetime (an unbounded, not
 *    turn-scoped, single use) has no carrier in the frozen IR. The wrapper that
 *    owns the window, replacement.event, needs a raw instruction array in
 *    args.instead while CardProgram Instruction.args are Expr:
 *    validateCardProgram rejects the bare array with "invalid-expression", and
 *    wrapping it in a constant makes the binder throw BlockedReplacementError
 *    "replacement.event instead must be an instruction body". The static
 *    replacement ability that this card does ship has no window at all, so it
 *    would apply to every qualifying death (measured: the bound registration
 *    matches a second kill too). And the window vocabulary has no unbounded
 *    one-shot either: "next-time-this-turn" is scoped to the turn the ability
 *    was bound in, "permanent" is not one-shot, and any other value is rejected
 *    as "Unsupported replacement.event window value".
 * 3. [Hidden]: the keyword declaration expands to { kind: "cost.hidden" }, but
 *    that static effect has no consumer. programs/statics.ts layerFor throws
 *    "Static ability kind cost.hidden has no layer mapping" at bind time, and
 *    cost/kinds/hidden.ts only locks and pays a plan (Hide action, facedown
 *    zone, and the beginning-next-turn Reaction / free play path of
 *    811.1.b/811.1.c.2 are still missing).
 *
 * What is merged and executed for real by the golden test: the replacement
 * planner resolves "that unit" through the published
 * { linked: "replacement.object" } selector (REPLACED_EVENT_LINK, 355.10.c) and
 * plans the kill-this step against the gear host plus the exhausted-status step
 * against the intercepted unit; the golden performs those planned actions on a
 * real kernel and asserts the resulting zones/status.
 */
const zhonyasHourglass = {
  canonicalCardId: "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（复核 2026-10-17），均实测且不近似实现：①缺独立 Recall 动作（457/458/459/460.1）：effect.move 的 mode \"recall\" " +
    "被原语显式阻断（negated/impossible + blockedReason \"Recall requires an action distinct from Move\"），替代 planner 在 bind 时对同一形状抛 " +
    "BlockedReplacementError（\"effect.move mode 'recall' is blocked (CR 457-460): no Recall action exists\"）；封闭 move-location 动作无法区分 Recall 与 Move（458.1 会错误触发移动触发、460.1 保持状态），不能近似为普通移动。" +
    "②印刷的 \"the next time\"（无回合界的一次性）在冻结 IR 里没有载体：拥有 window 的 replacement.event wrapper 要求 args.instead 是裸指令数组，" +
    "而 CardProgram 的 Instruction.args 是 Expr——裸数组被 validateCardProgram 以 invalid-expression 拒绝，constant 包装又让绑定层抛 " +
    "\"replacement.event instead must be an instruction body\"；本卡能写的静态 replacement ability 自身没有 window，实测同一注册会命中第二次死亡（等于把一次性降级成永久替代）。" +
    "window 词表也没有无界一次性：只有 permanent 与 next-time-this-turn（后者绑定注册回合、跨回合不再武装），其它取值被拒为 \"Unsupported replacement.event window value\"。" +
    "③[Hidden]（811.1.b/811.1.c.2）：关键词展开的 static { kind: \"cost.hidden\" } 没有消费方——programs/statics.ts 的 layerFor 在绑定时抛 " +
    "\"Static ability kind cost.hidden has no layer mapping\"，cost/kinds/hidden.ts 只做计划与支付，Hide 行动、面朝下区域与「下回合起 Reaction/免基础费打出」路径都仍缺。" +
    "已合入并有真实执行证据的部分：「that unit」经替代 planner 的 { linked: \"replacement.object\" }（REPLACED_EVENT_LINK，355.10.c）解析，" +
    "golden 把 kill-this 规划到本装备、把 exhausted 状态步骤规划到被拦截单位，并在真实内核上执行规划出的动作（含拦截单位存活、装备进弃牌堆与状态断言）。",
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
          // "kill this instead" — the merged replacement planner resolves the
          // source-object selector to the gear host and plans the kill action.
          id: "kill-this",
          op: "effect.kill",
          args: { target: { kind: "constant", value: { kind: "source" } } }
        },
        {
          // "Recall that unit exhausted." (457-460) The intercepted unit is
          // the replaced event's object, bound through the merged replacement
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
