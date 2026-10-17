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
 * 状态：judge-required。"I enter ready" 的替代形状现在有已合入的执行路径：
 * RIFT-260 的 src/replacement/（bindReplacement 声明形式 2，静态 replaces + 自指向
 * effect.ready 的 with 体）把卡牌的替代绑定为事件管线注册，并在 Chain 区永久物换到
 * Board 前改写取向；golden 用真实 ChainEngine 执行，断言单位以就绪状态进场且不产生
 * object-readied 事件。仍缺的是生产生命周期把 CardProgram 能力绑定进替代注册表
 * （契约 3.5），属 RIFT-257。不近似实现（不把就绪进场写成事后 effect.ready）。
 */
export default {
  canonicalCardId: "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺生产生命周期的卡牌程序绑定：I enter ready 的入场替代（CR 143.4、359.2.c、369.3；" +
    "805.6.a 说明不经过先横置再就绪的中间状态）已能由 RIFT-260 的 bindReplacement 执行——" +
    "golden 用本程序的 IR 经真实 ChainEngine 验证：就绪进场且无 object-readied 事件；" +
    "但把 CardProgram.abilities 的替代能力自动注册进事件管线的生命周期适配仍属 RIFT-257。" +
    "依赖：RIFT-257。不近似实现（不用事后 effect.ready 模拟入场替代）。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { self: true, exhausted: true }
      },
      with: [
        {
          id: "vanguard-attendant.enter-ready",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "I enter ready."
} satisfies CardProgram;
