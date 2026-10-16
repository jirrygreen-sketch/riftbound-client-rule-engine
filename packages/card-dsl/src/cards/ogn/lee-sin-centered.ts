import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lee Sin, Centered (ogn-151-298) — Unit（能量 6，力量 **null（无印刷值）**，Might 6，Body；
 * Lee Sin/Ionia/Champion）。
 *
 * 原文：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to
 *   have me enter ready.)
 *   Other buffed friendly units at my battlefield have +2 :rb_might:.
 *
 * 注意：catalog 中 `power: null` 表示**没有印刷力量**，不是 0（cards/README.md 第 2 节
 * 与本任务红线）；本程序不在任何地方把它写成 0。
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate] 805：关键词声明（展开由 effects/keywords/Accelerate.ts 负责）。
 * - "Other buffed friendly units at my battlefield have +2 :rb_might:."：持续型
 *   被动能力（364/364.3："have +2" 是陈述事实），在 arithmetic 图层给"我在的战场上"、
 *   有 Buff 的、其他友方单位 +2 Might（703：每个 Buff 贡献 +1 Might，这里读的是"是否
 *   被 Buff"这一状态）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - continuous.might 静态效果的消费方（图层系统按契约 3.4 计算）尚未合入：
 *   layers/engine.ts 的 arithmetic 图层只接受通过 ContinuousEffectSpec 注册的
 *   effect（id/layer/source/filter/effect），而卡程序的 static 能力没有把自身注册成
 *   ContinuousEffectSpec 的已合入路径（同 sfd rumble-hotheaded / forecaster 的
 *   continuous.grant-keyword 缺口）。
 * - "buffed" 需要可过滤状态：ObjectFilter 的 states 只列 ready/exhausted/stunned/
 *   attached/face-down（trigger-spec.ts 第 55 行），buffs 不是可过滤特征。
 * - "at my battlefield" 是随来源位置变化的过滤器锚点（sameLocationAs），需要在图层
 *   评估时把宿主位置作为锚点解析（continuing-effect 的 filter 目前只按对象特征匹配）。
 * 依赖：图层持续效果接线（contract 3.4 / RIFT-91 系列）与 buffed 谓词。不近似实现
 * （不用 continuous.grant-keyword 或 Buff 计数替代 Might 修正）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      filter: {
        type: "unit",
        controller: "controller",
        exclude: "self",
        sameLocationAs: "source",
        buffed: true
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "持续 Might 修正无法执行：（1）continuous.might 作为静态能力需要图层系统把它注册/" +
    "消费为 ContinuousEffectSpec（contract 3.4 的 arithmetic 图层），当前 layers/engine.ts " +
    "只评估外部注册的持续效果，卡程序 static 能力没有已合入的接线路径（同 sfd " +
    "rumble-hotheaded 的 continuous 缺口）。（2）“buffed” 不是可过滤状态：ObjectFilter 的 " +
    "states 只支持 ready/exhausted/stunned/attached/face-down，buffs 计数不在可过滤特征里" +
    "（702/703 的 Buff 状态因此无法作为 filter 条件）。（3）“at my battlefield” 需要以宿主" +
    "当前位置为锚点的 filter（sameLocationAs），图层侧尚未解析该锚点。依赖：图层持续效果" +
    "接线（RIFT-91 系列）与 buffed 谓词。Accelerate 只按 805 声明。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "Other buffed friendly units at my battlefield have +2 :rb_might:."
} satisfies CardProgram;

export default program;
