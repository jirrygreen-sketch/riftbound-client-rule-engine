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
 * 状态：judge-required。逐能力现状（以源码为准）：
 * 1. "I enter ready"（RIFT-260 声明形式 2）已可执行：随 RIFT-257 程序生命周期
 *    绑定为事件管线注册，在 Chain 区永久物换到 Board 前改写取向（CR 805.6/369.3）。
 *    golden 用 createProgramBinding + attachLifecycle 打出就绪进场。
 * 2. [Ganking]（RIFT-83 KeywordDef、RIFT-259 continuous.movement）仍不可执行：
 *    生命周期确实把展开的 static 注册进图层注册表，但
 *    effects/keywords/Ganking.ts 展开产出 permission: "battlefield-to-battlefield"
 *    （字符串），而 layers/rules/query.ts 的 movement() 只消费
 *    permission: { routes: [...] }（对象形状），record() 把字符串折叠成 {}，
 *    ruleView.canGank 恒为 false。zones/movement.ts 的 moveDuelUnitsStandard
 *    因此仍退回调用方 trusted hasGanking（standard-move-executor-v2 / cardplay
 *    的 services.ganking 回调），144.4.c 的战场间移动不读图层许可。
 *    契约变更请求：统一 Ganking 关键词展开的 permission 形状与
 *    layers/rules/query.ts 的消费形状（或让 query 同时接受字符串形式）。
 *    测试用 continuous.movement 指令路径保留了"许可被注册后能驱动
 *    moveDuelUnitsStandard"的真实执行证据（指令展开产出对象形状许可）。
 */
export default {
  canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Ganking (CR 810.1.c/144.4.c.1): the RIFT-257 lifecycle registers the expanded continuous.movement static, but effects/keywords/Ganking.ts emits permission as the string \"battlefield-to-battlefield\" while engine-core layers/rules/query.ts movement() consumes permission as a {routes:[...]} object, so ruleView.canGank stays false and moveDuelUnitsStandard still requires the caller's trusted hasGanking. Contract change request: unify the keyword expansion permission shape with the query consumption (or accept the string form in movement()). The enter-ready replacement is executable through the same lifecycle (see tests).",
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
