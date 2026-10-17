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
 *   载荷选择器（见 judgeReason 第 3 条），因此本卡不能宣称可执行。
 * - "during their first or second turn"：485.7 / 487.7 / 490.7 / 491.7 的
 *   First Turn Process 说明"第一回合"按模式与玩家分别调整，因此这是**每个玩家
 *   各自**的回合序号，而不是全局回合数（PipelineClock.turn 只是全局计数）。
 *
 * 结构说明：本条按契约 3.1 写成 replacement 能力（replaces + with + condition），
 * 保留可审查的形状；缺口的原语与规则见 judgeReason，不用近似手段替代。
 *
 * 复核（RIFT-337）：RIFT-260 已合入 replacement 绑定层（replacement/bind.ts 的
 * bindReplacement 会把 replaces 模式变成 ReplacementRegistration、把 with 计划成
 * 封闭 GameAction），因此“replacement 数据没有消费方”这句已经过时；仍缺的是
 * engine-core 内把 CardProgram 的 replacement 能力接到该绑定层的注册方
 * （RIFT-257 只提供 bindReplacement 回调，缺省不绑定），以及 485.7/487.7/490.7/491.7
 * 的“每个玩家各自的第一/第二回合”谓词；另外替代 body 的 “they draw 1 instead”
 * 需要把“被替代事件的得分者”绑定给 draw，而 replacement/planner.ts 的
 * effect.draw 只认 args.target，缺省取 planner.controller，没有该事件载荷选择器。
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
    "三处缺口：(1) 替代绑定层已合入（RIFT-260 的 replacement/bind.ts：bindReplacement 把 replaces 模式转成 " +
    "ReplacementRegistration、把 with 计划成封闭 GameAction），但 engine-core 内没有把 CardProgram 的 " +
    "replacement 能力接到该绑定层的注册方——RIFT-257 的 attachProgramLifecycle 只把 replacement 交给" +
    "调用方提供的 binder（缺省 noopStaticBinder，没有任何调用方传入实现），所以替代效果仍无生产入口；" +
    "(2) 'during their first or second turn' 需要**每个玩家各自**的回合序号（485.7/487.7/490.7/491.7 的 " +
    "First Turn Process 会按模式与先后手调整），contract 的 HistoryQuery 只有 turn/combat/game 三种 scope， " +
    "Condition 也没有该谓词，因此无法判定条件；(3) 'they draw 1 instead' 的 draw 需要绑定被替代事件的" +
    "得分者，而 replacement/planner.ts 的 effect.draw 只接受 args.target、缺省取 planner.controller，" +
    "没有“被替代事件的玩家”载荷选择器（现状会把 draw 记到能力控制者名下）。替换的 with 本体 effect.draw " +
    "已合入，可单独执行验证；" +
    "不近似实现（不改写全局回合计数、不把替代降级成额外抽 1 张）。",
  abilities,
  sourceText:
    "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead."
} satisfies CardProgram;
