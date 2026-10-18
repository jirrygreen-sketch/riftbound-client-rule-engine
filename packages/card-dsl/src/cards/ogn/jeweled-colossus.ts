import type { CardProgram } from "../../ir/index.js";

/**
 * Jeweled Colossus (ogn-086-298): Vision and unvalued Shield (defaults to 1).
 * CR v1.5 817.1.c / 437.1 and 814.1.b.3 / 814.1.c-d.1.
 *
 * status 判定（2026-10-17 复核）：judge-required。两处已实测的真实缺口：
 * 1. [Shield]：KeywordDef 展开出 static continuous.might + compare(object-property(self,
 *    "designation") eq "defender")，生产 static binder 能注册（实测 BOUND），但 bundled condition
 *    走 effects/interpreter/condition.ts → expr.ts 的默认派发，该派发只读 ObjectSnapshot 自身字段，
 *    对 "designation" 抛 MissingInformation（契约 3.8 只提供 combatRole）；statics.ts 的包一层
 *    try/catch 把异常吞成 false，所以 +1 Might 恒不生效（实测 combatRole="defender" 时 might 仍 4）。
 *    RIFT-711 合入的 expr-ext/evaluate.ts 已能把 designation/object-designation 映射到 combatRole，
 *    但 expr.ts / layers/engine.ts / programs/statics.ts 都未引用它（实测 0 处导入），缺的是默认派发接线。
 * 2. [Vision]：KeywordDef 展开的入场 filter 是 { objectId: "self", "object.id": "self" }，
 *    其中 "object.id" 不在 programs/filters.ts translateObjectFilter 的允许字段集合内，
 *    registerProgramTriggers 直接抛 "Unsupported filter field object.id"（实测），触发无法注册。
 *    另外展开体 effect.inspect 仍把 player 固定为 constant("A")，且 picksSpecId "vision-top"
 *    需要每次结算注入真实控制者与有序顶牌；programs/lifecycle.ts、programs/triggers.ts
 *    都没有该注入路径（437.1 / 817.1.c）。
 * 关键词只声明（README 第 5 节）；上述消费方未接线前不声称整卡可执行，也不近似实现。
 */
export default {
  canonicalCardId: "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814.1.c；814.1.b.3 未写数值按 1）的 KeywordDef 展开与生产 static binder 注册已实测可用，" +
    "但 designation 读取没有生产派发：effects/interpreter/condition.ts → expr.ts 只查 ObjectSnapshot 自身字段，" +
    "对 property \"designation\" 抛 MissingInformation，programs/statics.ts 的 try/catch 把它吞成 false，" +
    "实测 combatRole=\"defender\" 时 might 仍为印刷值、+1 恒不生效；RIFT-711 合入的 expr-ext/evaluate.ts 已能把 " +
    "designation/object-designation 映射到 combatRole，但 expr.ts、layers/engine.ts、programs/statics.ts 均未引用它" +
    "（实测 0 处导入），缺的是默认派发接线。" +
    "[Vision] 展开的入场 filter 含 \"object.id\": \"self\"，不在 programs/filters.ts translateObjectFilter 的允许字段集合内，" +
    "registerProgramTriggers 实测抛 \"Unsupported filter field object.id\"，触发无法注册；" +
    "展开体 effect.inspect 仍把 player 固定为 constant(\"A\")，picksSpecId \"vision-top\" 需要每次结算注入真实控制者与有序顶牌，" +
    "programs/ 没有该注入路径（817.1.c、437.1）。关键词只声明，上述消费方未接线前不声称整卡可执行。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
    { kind: "keyword", keyword: "shield" }
  ],
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "[Shield] (+1 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
