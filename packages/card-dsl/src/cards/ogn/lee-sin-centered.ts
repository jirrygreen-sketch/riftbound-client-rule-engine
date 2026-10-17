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
 * - continuous.might 的指令入口已合入（RIFT-258，图层算术层会消费通过
 *   ResolveContext.addContinuous 注册的效果），但卡牌 static 能力没有把它注册成
 *   ContinuousEffectSpec 的已合入路径：登记面仍由解释器/原语在结算时调用，
 *   卡程序绑定（RIFT-257）未合入，本卡的常驻光环在真实对局中不会生效。
 * - "buffed" 需要可过滤状态：ObjectFilter/states 只列 ready/exhausted/stunned/
 *   attached/face-down（trigger-spec.ts），buffs 计数不在可过滤特征里。
 * - "at my battlefield" 是随来源位置变化的过滤器锚点：解释器（queryObjects）已解析
 *   sameLocationAs/exclude，但图层引擎的 filter 只按对象特征匹配（layers/filter.ts），
 *   还没有把宿主位置作为常驻效果锚点的求值路径。
 * 依赖：RIFT-257（CardProgram → 图层注册）与 buffed 谓词/图层位置锚点。不近似实现
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
    "持续 Might 修正仍不可执行：（1）continuous.might 指令原语已合入（RIFT-258，arithmetic 层按契约 3.4 求值），" +
    "但卡程序 static 能力没有已合入的注册路径（RIFT-257；登记只能由解释器/原语在结算时通过 ResolveContext.addContinuous 触发），" +
    "本卡的常驻光环在真实对局中不会注册。（2）“buffed” 不是可过滤状态：ObjectFilter/states 只支持 " +
    "ready/exhausted/stunned/attached/face-down，buffs 计数不在可过滤特征里（702/703 的 Buff 状态无法作为 filter 条件）。" +
    "（3）“at my battlefield” 需要以宿主当前位置为锚点的 filter（sameLocationAs），解释器已解析该锚点，" +
    "但图层引擎的 filter 尚未解析（layers/filter.ts 只匹配对象特征）。依赖：RIFT-257 与 buffed 谓词、图层位置锚点。" +
    "Accelerate 只按 805 声明。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "Other buffed friendly units at my battlefield have +2 :rb_might:."
} satisfies CardProgram;

export default program;
