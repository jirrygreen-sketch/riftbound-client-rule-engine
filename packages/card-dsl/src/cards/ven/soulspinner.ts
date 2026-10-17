import type { CardProgram } from "../../ir/index.js";

/**
 * Soulspinner (ven-123-166) — Unit, Order, tags Shadow Isles/Spider.
 * 3 Energy, no printed Power (`power: null`，不是 0), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-123-166，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 822.1 / 822.1.a：Ambush 是被动能力关键词，通常出现在单位上。
 * - 822.1.b：功能上等于「我可以被打到我有单位的战场」且「在被打到我有单位的
 *   战场的过程中，我具有 [Reaction]」。
 * - 822.1.c：它是被动能力，在 Playing a Card 的 Make Relevant Choices 步骤为
 *   单位增加合法打出位置。
 * - 822.2：多重实例冗余；822.3：若 Finalize 完成前选定位置上已没有单位，该位置
 *   就不再因 Ambush 而合法（822.3.a 的其他许可另算）；822.4：「是否拥有 Ambush」
 *   是可被引用的单位特征。
 * - 按契约 3.1/3.7 与 README 第 5 节，本卡只声明关键词身份
 *   （`{ kind: "keyword", keyword: "ambush" }`，无印刷数值），展开属于
 *   effects/keywords/Ambush.ts（已合入，RIFT-266）。
 *
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：continuous.timing 图层查询已接入
 * chain.canAct（actionTimings → canActByRules），keyword static 也已有生产注册入口
 * （programs/keywords.ts → programs/statics.ts），早前这两条缺口已过时。
 *
 * status 判定（README 第 2 节）：judge-required。
 * Ambush 的展开是两条 static 声明（play-location-permission 与
 * continuous.timing）；当前真实缺口是：
 * 1. play-location-permission：engine-core/src 下只有卡牌数据与 Ambush.ts 自己
 *    声明它，Finalize 的合法打出位置校验（822.1.c / 822.3）没有读取方；
 * 2. permitted.battlefield 的对象形条件（occupied: true / controller:
 *    "controller"）没有求值方：Ambush.ts 只声明该形状，Finalize 侧没有读取方。
 * 依赖：打出位置校验接线（822.1.c / 822.3）与 occupied-battlefield 条件求值。
 * 不近似实现（不把许可写成默认打出位置，也不把它改成无条件的 Reaction）。
 */
export default {
  canonicalCardId: "card.hash-b3976fdbbb870e1d3f2e8cd4a8c353a35d653828284910792b79b5d6e6982f12",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Ambush]（822）的 KeywordDef 已合入（effects/keywords/Ambush.ts，RIFT-266，展开为 static " +
    "play-location-permission 与 static continuous.timing），但两个消费方未合入：" +
    "(1) play-location-permission 在 engine-core/src 下只有 Ambush.ts 声明，Finalize 的合法打出位置校验" +
    "（822.1.c / 822.3）没有读取方；" +
    "(2) permitted.battlefield 的对象形条件（occupied: true / controller: controller，822.1.b）没有求值方，" +
    "Ambush.ts 只声明该形状。chain.canAct 的图层时机消费（continuous.timing grants）与 keyword static 的" +
    "生产注册入口均已合入，不再列为缺口。" +
    "依赖：打出位置校验接线、occupied-battlefield 条件求值。" +
    "不近似实现（不改成默认打出位置或无条件的 Reaction）。",
  abilities: [{ kind: "keyword", keyword: "ambush" }],
  sourceText: "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)"
} satisfies CardProgram;
