import type { CardProgram } from "../../ir/index.js";

/**
 * Concentrate (unl-091-219) — Spell, 5 energy, no printed power, no Might,
 * Body.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-091-219，逐字）：
 *   "Draw 2.\n"
 *   "[Level 6][>] This costs :rb_energy_2: less. (While you have 6+ XP, get the
 *    effect.)\n"
 *   "[Level 11][>] This costs :rb_energy_4: less instead."
 *
 * 规则依据（CR v1.5）：
 * - 「Draw 2」是已合入的 effect.draw（414.1 / 414.3），可执行。
 * - [Level 6] / [Level 11]（824.1.a / 824.1.b / 824.1.b.1 / 824.1.c）：
 *   从关键词到子句结尾整段是 Level Ability，功能等价于"当你的 XP 达到 N 时，
 *   本牌获得<该子句文本>"，控制者 XP 变化会即时让依赖能力 Active/Inactive
 *   （824.1.c.1 / 824.1.d）。两条子句互斥改写的同一费用（"instead"，356.4）。
 * - 「This costs [2]/[4] less」是 356.4 的印刷费用折扣，按 356.1.c 以印刷基础
 *   费用为基准，在 Finalize 的费用计划里结算（不是链上结算的指令）。
 * - effects/keywords/Level.ts 已合入：它把 [Level N] 展开为一个
 *   condition.predicate 的 static 谓词（LEVEL_PREDICATE，query "controller-xp"），
 *   但该谓词的消费者与 XP 读取路径仍未合入（文件头注明 keyword→ability 绑定与
 *   玩家 XP 的 Expr 读取都缺失）。
 *
 * Status: judge-required. Current source audit:
 * Draw 2 is executable independently. The static discounts need a Finalize
 * consumer and live XP gating; a named constant string is not that predicate.
 */
const concentrate = {
  canonicalCardId: "card.hash-faa895f1e7713ee3a12d2dc5921967e2171457086b5582208825c5b0eae45fd6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 programs/statics.ts 将静态 cost.modify 接入 Finalize discounts 的映射（CR 356.4），以及 Level 6/11 的控制者 XP 条件消费（824.1.b.1/824.1.c）。当前 level-active 常量字符串会被当成真值，不能读取 XP，也不能令 -2 与 -4 的 instead 折扣互斥；不可把两档折扣相加或硬编码其中一档。",
  abilities: [
    {
      // 「[Level 6][>] This costs [2] less」的保留形状：折扣在 Finalize 费用计划里
      // 应用，尚无卡牌可声明的消费者（见 judgeReason）。
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        component: "total",
        appliesTo: "self",
        amount: { kind: "constant", value: -2 }
      },
      condition: { kind: "expression", value: { kind: "constant", value: "level-active:6" } }
    },
    {
      // 「[Level 11][>] This costs [4] less instead」：同一费用的互斥改写；
      // "instead" 的排他性由 XP 阈值判定承担（尚无消费者，见 judgeReason）。
      kind: "static",
      effect: {
        kind: "cost.modify",
        resource: "energy",
        component: "total",
        appliesTo: "self",
        amount: { kind: "constant", value: -4 }
      },
      condition: { kind: "expression", value: { kind: "constant", value: "level-active:11" } }
    },
    {
      kind: "play",
      body: [
        {
          id: "concentrate.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "Draw 2.\n" +
    "[Level 6][>] This costs :rb_energy_2: less. (While you have 6+ XP, get the effect.)\n" +
    "[Level 11][>] This costs :rb_energy_4: less instead."
} satisfies CardProgram;

export default concentrate;
