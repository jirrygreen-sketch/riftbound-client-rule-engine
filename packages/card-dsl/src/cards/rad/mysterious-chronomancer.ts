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
 * status 判定（README 第 2 节）：judge-required。缺口：
 * 1. `effects/keywords/` 没有 Predict（kw-predict）KeywordDef——RIFT-83 的 Vision 展开里
 *    也只内联了 Predict 1 的两步，没有可复用的 [Predict X] 关键词展开；本卡不手写一套
 *    相同逻辑（README 第 5 节），因此保持 judge-required；
 * 2. `effects/keywords/` 没有 Disarm KeywordDef（RIFT-81~91 关键词批次不含 Disarm），
 *    Disarm 的临时 Might 修改还需要 continuous.might + continuous.duration（143.2.a / 475）。
 * 依赖：Predict / Disarm KeywordDef（均无已分配任务号）、RIFT-91（layers-continuous）。
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
    "缺两个关键词展开：" +
    "(1) Predict（kw-predict，437.1 / 437.3 的 [Predict X]）在 effects/keywords/ 中没有 KeywordDef，" +
    "RIFT-83 的 Vision 只内联了 Predict 1 的看牌 + 可选回收两步，没有可复用的 [Predict 2] 展开；" +
    "按 README 第 5 节本卡只声明 keyword: predict / value: 2，不手写展开。" +
    "(2) Disarm（831）在 effects/keywords/ 中没有 KeywordDef，其展开需要一次攻击触发 + 临时 Might 修改" +
    "（continuous.might + continuous.duration，143.2.a / 475），图层与到期处理属 RIFT-91 后续原语批次。" +
    "依赖：Predict KeywordDef、Disarm KeywordDef（均无已分配任务号）、RIFT-91（layers-continuous）。" +
    "不近似实现：不用 effect.inspect 手写 Predict、不用 Buff counter 代替 Might 修改。",
  abilities,
  sourceText:
    "When you play me, [Predict 2]. (Look at the top 2 cards of your Main Deck. " +
    "Recycle any of them and put the rest back in any order.)\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
