import type { CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Honed (ogs-009-024) — Unit, 7 energy / 1 power (Body), Might 6.
 *
 * sourceText (deck-catalog.json, ogs-009-024, verbatim):
 *   "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready."
 *
 * 规则依据（CR v1.5）：
 * - 810：Ganking 是单位上的被动能力关键词（810.1.a），功能等价于"我可以从另一个
 *   战场移动到这个战场"（810.1.b），为 Standard Move 增加许可（810.1.c）。关键词
 *   展开归 effects/keywords/Ganking.ts（810 已并入该文件：continuous.movement）。
 * - 143.4：单位横置进场（359.2.c 同）；"I enter ready" 是入场替代（369.3 类）：
 *   把"横置进场"改写为"就绪进场"。effect.ready 文件头明确：enter ready 是入场替代，
 *   不是事后重置，也不能用 effect.ready 模拟。
 *
 * 状态：judge-required。两个依赖都未合入：
 * 1. continuous.movement 的消费方（移动系统读取 Ganking 许可）尚未实现——
 *    Ganking.ts 文件头自述"移动系统（zones/movement.ts）尚无读取 continuous.movement
 *    许可的接口"（RIFT-89~91 的 continuous.* 批次）。
 * 2. 入场替代管线（replacement.enter 家族）未合入：Accelerate.ts（805.6 同型）
 *    也把 cost.additional/replacement.enter 标为未合入。
 * 本文件按契约写出 keyword 与替代形状，with 体只引用已合入的 effect.ready 指令，
 * 不把该指令当作入场替代的替代实现。
 */
export default {
  canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.movement 消费方：Ganking 展开为静态移动许可（continuous.movement，" +
    "CR 810.1.b/810.1.c），但 zones/movement.ts 尚无读取该许可的接口（RIFT-89~91 的 " +
    "continuous.* 批次）；I enter ready 是入场替代（CR 143.4、359.2.c、369.3），" +
    "replacement.enter 管线未合入（Accelerate.ts 同型依赖），effect.ready 不能模拟" +
    "入场替代。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        object: { objectId: "self", states: "exhausted" }
      },
      with: [
        {
          id: "master-yi-honed.enter-ready",
          op: "effect.ready",
          args: {}
        }
      ]
    }
  ],
  sourceText: "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready."
} satisfies CardProgram;
