import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mysterious Chronomancer (rad-050-167) — Unit, 5 energy, 4 Might, Mind.
 *
 * 原文："When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. "
 *       "Recycle any of them and put the rest back in any order.)\n"
 *       "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：Play Effect（383.4.a / 420.4.a），但 [Predict 2] 本身是 437 的
 *   Limited Action 关键词式引用（437.1 / 437.3 的 "Predict X"，437.3.a：省略数值按 1；
 *   这里印刷值为 2）。按 README 第 5 节，卡牌只声明关键词、不重写展开；展开（看顶、
 *   可选回收、任意顺序放回顶部，437.1.a）应由 effects/keywords/<predict>.ts 负责。
 * - [Disarm 2]：831.1.b / 831.1.d（攻击触发，功能等价于 "When I attack, give an enemy
 *   unit here -2 [M] this turn"）；831.1.c 的 X = 2，声明时带 value: 2。
 *
 * status 判定（README 第 2 节）：judge-required（2026-10-17 复核）。
 * 已解决、不再列为缺口：[Disarm] 的 KeywordDef 已合入（effects/keywords/Disarm.ts，831.1.b/
 * 831.1.d/831.2，展开为 attack-declared 触发 + continuous.might -X + this-turn 期限），
 * 其展开有真实执行证据（golden 断言展开结构并执行其 continuous.might 指令）。
 * 当前缺口：
 * 1. [Predict 2]（437.1 / 437.1.a / 437.3）没有可复用的 KeywordDef：RIFT-269 只提供了
 *    Predict 的组合形状（effect.inspect + effect.recycle + effect.order，见
 *    engine-core/test/effects/instructions/effect.predict.test.mjs），没有 effects/keywords/
 *    Predict.ts；按 README 第 5 节本卡只声明 keyword，不手写展开。
 * 2. effect.inspect 的非零 top 查看要求上游按牌库顶提供有序 picks（缺则 negated/impossible），
 *    契约 3.6 的 zoneSlice 尚未被 inspect 消费。
 * 3. 没有已合入路径把 CardProgram 的 keyword 能力展开并注册进图层/时点（引擎不读取
 *    CardProgram 能力；RIFT-257）。
 * 依赖：Predict KeywordDef（无已分配任务号）、zoneSlice 被 inspect 消费（RIFT-64/66）、
 * RIFT-257。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "predict", value: 2 },
  { kind: "keyword", keyword: "disarm", value: 2 }
];

const program = {
  canonicalCardId:
    "card.hash-6b0bcf2f0d70419ac960f2e10f95b86b212de65ad51127d9ca67749bf9316641",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-17 复核：Disarm 的 KeywordDef 已合入（effects/keywords/Disarm.ts：attack-declared 触发 + " +
    "continuous.might -2 + this-turn 期限，831.1.b/831.1.d/831.2），该缺口删除。剩余缺口：" +
    "(1) [Predict 2]（437.1 / 437.1.a / 437.3）没有可复用的 KeywordDef——RIFT-269 只提供 Predict 的组合形状" +
    "（effect.inspect + effect.recycle + effect.order），effects/keywords/ 没有 Predict.ts；按 README 第 5 节本卡只声明 keyword。" +
    "(2) effect.inspect 的非零 top 查看要求上游按牌库顶提供有序 picks（缺则 negated/impossible），" +
    "契约 3.6 的 zoneSlice 尚未被 inspect 消费（RIFT-64/66 缺口）。" +
    "(3) 没有已合入路径把 CardProgram 的 keyword 能力展开并注册进图层/时点（引擎不读取 CardProgram 能力，RIFT-257）。" +
    "不近似实现：不用 effect.inspect 手写 Predict。依赖：Predict KeywordDef（无已分配任务号）、zoneSlice 接线、RIFT-257。",
  abilities,
  sourceText:
    "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
    "Recycle any of them and put the rest back in any order.)\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
