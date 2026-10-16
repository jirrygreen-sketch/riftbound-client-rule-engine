import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Qiyana, Victorious (ogn-155-298) — Unit（能量 4，力量 1，Might 4，Body；Qiyana/Ixtal/Champion）。
 *
 * 原文：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   When I conquer, draw 1 or channel 1 rune exhausted.
 *
 * 规则依据（CR v1.5）：
 * - [Deflect] 809：关键词声明（target.tax 的按次追加支付）。
 * - 383.4.c / 383.4.c.1："When I conquer…" 是 Conquer Effect，时点 "conquer"
 *   （由 scoring/ 在建立控制并得分后发出，473.1）。
 * - "draw 1 or channel 1 rune exhausted" 是结算时的二选一（355.5.a 的选择），
 *   用 choice.mode（count 1、different true）表达，两个分支分别用已合入的
 *   effect.draw（414.3）与 effect.channel（431.1/431.2：符文横置进场）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Deflect] 的展开（keywords/Deflect.ts 输出 static target.tax）没有消费方：
 *   契约 3.8 第 4 条把"成为目标/目标锁定通知"放到引擎批 4，
 *   TargetPlan 的 TargetTaxAdapter（target/target-plan.ts）只接受调用方经
 *   TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 target.tax
 *   静态效果的路径（RIFT-90）；同时 cost.pay 也没有把 Deflect 税并入费用计划。
 * - 时点 "conquer" 尚无发射方：scoring/ 只返回 triggerScore 指令，没有把
 *   "conquer" 时点交给事件管线的接线（P0 契约 §7.2 批 5 / 评分集成）。
 * 依赖：RIFT-90（目标税与目标锁定通知）、RIFT-89（费用计划合并税）、评分/时点接线。
 * 不近似实现（不把 Deflect 写成静态数值，也不跳过目标税）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "qiyana.draw-or-channel",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "qiyana.draw-mode",
                body: [
                  {
                    id: "qiyana.draw",
                    op: "effect.draw",
                    args: { amount: { kind: "constant", value: 1 } }
                  }
                ]
              },
              {
                id: "qiyana.channel-mode",
                body: [
                  {
                    id: "qiyana.channel",
                    op: "effect.channel",
                    args: {
                      amount: { kind: "constant", value: 1 },
                      exhausted: { kind: "constant", value: true }
                    }
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
  canonicalCardId: "card.hash-f26c9365df2b773179f654031d3a114d51b6f183d2086ba1fa9f1891050a0a71",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：（1）[Deflect]（809）的展开是 static target.tax，但没有消费方——" +
    "契约 3.8 第 4 条把目标税通知放在引擎批 4，TargetPlan 的 TargetTaxAdapter 只接受调用方 " +
    "经 TargetFinalizeOptions.tax 传入的税，链的 Finalize 没有从图层读取 CardProgram 静态 " +
    "target.tax 的接线，cost.pay 也没有把目标税并入费用计划（依赖 RIFT-89 费用计划与 RIFT-90 目标税；" +
    "keywords/Deflect.ts 的注释同款缺口）。（2）时点 conquer（473.1 征服得分后）没有发射方：" +
    "scoring/ 只返回 triggerScore 指令，未把 conquer 时点交给事件管线，征服触发无法进入链" +
    "（P0 契约 §7.2 批 5 / 评分集成）。body 的 draw/channel 二选一结构完整，" +
    "golden 测试分别用已合入的 effect.draw 与 effect.channel 原语执行。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When I conquer, draw 1 or channel 1 rune exhausted."
} satisfies CardProgram;

export default program;
