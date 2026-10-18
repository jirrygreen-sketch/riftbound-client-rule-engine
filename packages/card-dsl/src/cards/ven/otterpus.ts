import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Otterpus (ven-053-166) — Unit, Mind, Bandle City.
 *
 * 原文："If a player would score 1 point from conquering or holding during their
 * first or second turn, they draw 1 instead."
 *
 * 规则依据（Core Rules v1.5）：
 * - 369.1：Replacement Effect 由 "as" / "would" / "instead" 这类措辞标识，
 *   本卡的 "would … instead" 正是替代效果。
 * - 471.1/471.2：Score 的两种方式为 Conquer（Control 一个本回合尚未 Score 的
 *   Battlefield）与 Hold（Beginning Phase 中维持控制并计分）；470.1/470.3 与
 *   473 描述计分与得点。时点 "score"（events/timing-points.ts，ruleRefs 470.1 /
 *   470.3 / 471 / 473.2）同时覆盖 Conquer 与 Hold，因此替代的目标事件用
 *   event "score" 表达，不需要额外区分两种方式。
 * - 473.1：Score 时最多 Gained 1 点（本卡文字也只针对 1 点的替代）。
 * - "they draw 1 instead" = effect.draw（414.1/414.3，已合入原语）；"they" 指被
 *   替代的得分者，由替代效果负责把得分者绑定到 draw 的玩家。该绑定本身没有
 *   载荷选择器（见 judgeReason 第 2 条），因此本卡不能宣称可执行。
 * - "during their first or second turn"：485.7 / 487.7 / 490.7 / 491.7 的
 *   First Turn Process 说明"第一回合"按模式与玩家分别调整，因此这是**每个玩家
 *   各自**的回合序号，而不是全局回合数（PipelineClock.turn 只是全局计数）。
 *
 * 结构说明：本条按契约 3.1 写成 replacement 能力（replaces + with + condition），
 * 保留可审查的形状；缺口的原语与规则见 judgeReason，不用近似手段替代。
 *
 * 复核：RIFT-260 的 replacement 绑定层与默认 lifecycle 注册已经可用；仍缺的是 485.7/487.7/
 * 490.7/491.7 的“每个玩家各自的第一/第二回合”谓词，以及替代 body 的 “they draw 1 instead”
 * 对被替代事件得分者的载荷绑定。replacement/planner.ts 的 effect.draw 只认 args.target，缺省取
 * planner.controller，没有该事件载荷选择器。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "score",
      player: "any"
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "per-player-turn-is-first-or-second" }
    },
    with: [
      {
        id: "otterpus.draw-instead",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-88f5798e902358ceaf4c13e100918b603ddcdb5d2e0d5bc1d6df65283fdc2f61",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（2026-10-17 RIFT-733 复核实测）：" +
    "(1) “during their first or second turn”需要每位得分玩家各自的回合序数（485.7 / 487.7 / 490.7 / 491.7）。" +
    "卡牌 IR 只有 condition.history（HistoryQuery 的动作/时点计数）与对象过滤器；turn/flow.ts 的 turns 仍是私有 Map，" +
    "没有暴露给 Condition 的读数，因此程序保留显式常量谓词占位而不是用全局回合计数近似。" +
    "(2) “they draw 1 instead”需要被替代事件的得分者：replacement/planner.ts 的 effect.draw 只读 args.target、" +
    "缺省取 planner.controller，ReplacementPlanInput 只绑定 replacement.object，没有事件玩家载荷选择器，" +
    "所以对 B 的得分会错误地替 A 抽牌。" +
    "(3) turn/flow.ts 在实际征服/固守计分事务中仍拒绝把 score 替换为 draw" +
    "（TurnCombatBlockedError:replaced-scoring，见 turn/flow.ts 的 structural Score 检查），" +
    "还缺结构性 Score 替代与计分账本的一致提交。通用 replacement 注册与 draw 本体已可执行，" +
    "不把规划结果或额外抽牌当作实际计分替代。",
  abilities,
  sourceText:
    "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead."
} satisfies CardProgram;
