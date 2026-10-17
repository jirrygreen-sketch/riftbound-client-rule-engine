import type { CardProgram } from "../../ir/index.js";

/**
 * Karthus, Eternal (ogn-236-298), CR v1.5 808.1-808.2 / 383.4.g.2.
 * 复核（2026-10-17，第三轮 M2 覆盖率复核）：
 * - 已合入并实测的两条链路：(1) RIFT-257 的卡程序绑定能把本牌 static 能力取到
 *   （programs/statics.ts 的 createEngineStaticBinder），(2) 展开后的 Deathknell 触发
 *   （effects/keywords/Deathknell.ts，stacking "separate"）经 binding.inspect 可见。
 * - 仍缺（缺口一，核心）：**触发收集倍率**。continuous.trigger-multiplicity 既没有
 *   图层映射也没有规则查询——实测 bindStatic 抛 “Static ability kind
 *   continuous.trigger-multiplicity has no layer mapping”，把 appliesTo 换成 self 也一样；
 *   全仓库没有任何 trigger-multiplicity 消费者，EventPipeline.scan 不读 additional 次数。
 *   CR 808.2/383.4.g.2 的「额外触发一次」是**收集期**行为，不能用结算期 effect.repeat 替代。
 * - 仍缺（缺口二）：本牌 appliesTo 需要用 deathknell 关键词 + 控制者 + 区域筛选宿主，而
 *   programs/statics.ts 的 staticTarget 只接受 self/source 或无锚点过滤，实测抛
 *   “Unsupported static appliesTo {…}”。该形状需要「按关键词特征筛选宿主」的规则上下文。
 * - 仍缺（缺口三）：Deathknell 展开体仍引用未注册的 op trigger.leave（已实测
 *   instructionDefinitionsById 不含它），卡牌正文未接到死亡触发。
 */
const karthusEternal = {
  canonicalCardId: "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 触发收集倍率：continuous.trigger-multiplicity 既无图层映射也无规则查询" +
    "（实测 bindStatic 抛 “Static ability kind continuous.trigger-multiplicity has no layer mapping”，" +
    "换成 appliesTo self 亦然），全仓库无消费者，EventPipeline.scan 不读 additional 次数；" +
    "CR 808.1/808.2 与 383.4.g.2 的「额外触发一次」是收集期行为，不能用结算期 effect.repeat 替代。" +
    "(2) 该 static 的 appliesTo 需要按 deathknell 关键词 + 控制者 + 区域筛选宿主，" +
    "programs/statics.ts 的 staticTarget 只接受 self/source 或无锚点过滤（实测抛 " +
    "Unsupported static appliesTo），尚无「按关键词特征筛选」的规则上下文。" +
    "(3) Deathknell 展开体仍引用未注册的 op trigger.leave（instructionDefinitionsById 无此表项），" +
    "卡牌正文尚未接到死亡触发。已合入可用：RIFT-257 的 static 能力取用路径与 Deathknell 展开本身。",
  sourceText: "Your [Deathknell] effects trigger an additional time.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.trigger-multiplicity",
        mode: "additional",
        amount: { kind: "constant", value: 1 },
        appliesTo: {
          keyword: "deathknell",
          controller: "controller",
          zone: "board"
        }
      }
    }
  ]
} satisfies CardProgram;

export default karthusEternal;
