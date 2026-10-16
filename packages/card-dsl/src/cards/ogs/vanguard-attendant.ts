import type { CardProgram } from "../../ir/index.js";

/**
 * Vanguard Attendant (ogs-016-024) — Unit, 6 energy / 1 power (Order), Might 5.
 *
 * sourceText (deck-catalog.json, ogs-016-024, verbatim):
 *   "I enter ready."
 *
 * 规则依据（CR v1.5）：
 * - 143.4 / 359.2.c：单位以横置状态进入 Board；369.3（及其类别）说明"I enter ready"
 *   是入场替代效果——把"横置进场"改写为"就绪进场"。
 * - 805.6.a（Accelerate 的同型语义）：这类替代不经过"先横置再就绪"的中间状态，因此
 *   不与"成为就绪"类触发互动。
 * - effect.ready 文件头明确：enter ready 是入场替代，不是事后重置，不能用该原语模拟。
 * - 契约 3.1 用 replacement 能力形状描述替代（replaces 匹配本卡自身以横置状态进入
 *   Board 的事件，with 体是替代结果）。
 *
 * 状态：judge-required。缺少"卡牌程序的替代能力 → 事件管线 replacement 注册与执行"
 * 的适配路径：事件管线有 PipelineHost.registerReplacement（Contract 3.5 的替代在动作
 * 提交前拦截），但没有把 CardProgram.abilities 的 replacement 装配进去的实现。
 * Accelerate.ts（805.6 同型延迟替代）与 sfd/breakneck-mech.ts 的 "I enter ready if ..."
 * 都记录了同一未合入批次（RIFT-89~91）。本文件只写出替代形状，with 体的 effect.ready
 * 指令不作为入场替代的替代实现。
 */
export default {
  canonicalCardId: "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺入场替代的装配与执行路径：I enter ready 把单位的横置进场替换为就绪进场" +
    "（CR 143.4、359.2.c、369.3；805.6.a 说明不经过先横置再就绪的中间状态），" +
    "契约 3.1 只能写成 replacement 能力，而卡牌替代能力到事件管线 replacement 注册与" +
    "执行的适配路径未合入（Accelerate.ts 805.6 的延迟替代、sfd/breakneck-mech.ts 的 " +
    "enter-ready 同属该批次）；effect.ready 明确不能模拟入场替代。" +
    "依赖：RIFT-89~91（replacement.enter / layers-continuous 批次）。不近似实现。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        object: { objectId: "self", states: "exhausted" }
      },
      with: [
        {
          id: "vanguard-attendant.enter-ready",
          op: "effect.ready",
          args: {}
        }
      ]
    }
  ],
  sourceText: "I enter ready."
} satisfies CardProgram;
