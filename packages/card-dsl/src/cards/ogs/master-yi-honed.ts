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
 * 状态：judge-required。两个能力分开判定：
 * 1. [Ganking] 的 KeywordDef（RIFT-83）与 continuous.movement 原语（RIFT-259）
 *    已合入，layers/rules/query.ts 的 movement() 也能读出 battlefield-to-battlefield
 *    许可；但没有任何已合入的 Standard Move 执行器消费该许可
 *    （combat/flow.ts 的 move() 仍抛 standard-move-transaction；zones/movement.ts
 *    的 hasGanking 由调用方以 trusted 回调注入），因此"我能战场间移动"还不可执行。
 * 2. "I enter ready" 的替代形状（RIFT-260 的 bindReplacement 声明形式 2）已可执行：
 *    with 体使用显式 { kind: "source" } 选择符（同 Accelerate.ts），golden 把它绑到
 *    真实 ChainEngine 上执行、断言单位以就绪状态进场且不产生 object-readied 事件。
 *    生产生命周期里的卡牌程序绑定（RIFT-257）尚未合入。
 */
export default {
  canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) [Ganking]（CR 810.1.b/810.1.c）的 KeywordDef 与 continuous.movement 原语、" +
    "movement() 查询均已合入，但没有已合入的 Standard Move 执行器读取该许可" +
    "（combat/flow.ts 的 move() 仍需原子化的 Exhaust+Move 事务；zones/movement.ts 的 hasGanking" +
    "由调用方 trusted 回调注入），810.1.c 的额外战场间移动还不生效。" +
    "(2) I enter ready 的入场替代（CR 143.4、359.2.c、369.3/805.6.a）现在可由 RIFT-260 的 " +
    "bindReplacement 执行（golden 已用真实链验证：就绪进场且无 object-readied 事件），" +
    "但生产生命周期把 CardProgram 能力绑进替代注册表的路径属 RIFT-257。" +
    "不近似实现（不把就绪进场写成事后 effect.ready，也不把 Ganking 写成默认移动许可）。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { self: true, exhausted: true }
      },
      with: [
        {
          id: "master-yi-honed.enter-ready",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "[Ganking] (I can move from battlefield to battlefield.)\nI enter ready."
} satisfies CardProgram;
