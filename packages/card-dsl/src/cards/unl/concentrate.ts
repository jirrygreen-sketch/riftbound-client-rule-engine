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
 *   但该谓词的消费者仍未合入；按现有 IR 约定，下面用
 *   `count(subject: "controller-xp")` 保留真实门槛，不能用恒真的字符串常量冒充 XP。
 *
 * Status: judge-required. Re-checked 2026-10-18 against merged source:
 * Draw 2 executes through the merged effect.draw. Both blockers persist:
 * (1) cost/plan-types.ts accepts caller-supplied `discounts` and the plan really
 * subtracts them, but no merged path derives them from a card's static effect —
 * programs/statics.ts `layerFor` still rejects the cost.modify kind outright
 * ("Static ability kind cost.modify has no layer mapping"), and chain/engine.ts
 * Finalize only plans `item.cost` plus caller taxes.
 * (2) the [Level 6]/[Level 11] gates retain `count(subject: "controller-xp")`,
 * but the merged base evaluator ignores the subject and counts matching objects;
 * the expr-ext player-property reader is not wired into card-program conditions,
 * so the two "instead" discounts cannot be made exclusive.
 */
const concentrate = {
  canonicalCardId: "card.hash-faa895f1e7713ee3a12d2dc5921967e2171457086b5582208825c5b0eae45fd6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两段接线（2026-10-17 复核，均不近似实现）：" +
    "(1) 静态 cost.modify → Finalize discounts（CR 356.4）：费用计划本身已能接受调用方传入的 discounts 并真实扣减印刷能量费，" +
    "但没有生产消费者从卡牌静态效果生成该输入——programs/statics.ts 的 layerFor 直接拒绝 cost.modify（\"Static ability kind cost.modify has no layer mapping\"），" +
    "chain/engine.ts 的 Finalize 也只按 item.cost 与调用方 tax 组计划；" +
    "(2) [Level 6]/[Level 11] 的控制者 XP 门控（CR 824.1.b.1/824.1.c/824.1.c.1）：合并的 Condition 词汇（always/never/compare/all/any/not/expression 及 played-from-*/printed-characteristic/result 谓词）" +
    "不能读取玩家 XP，卡内的 level-active 常量字符串会被求值为真，因此 -2 与 -4 的 instead 互斥无法判定。" +
    "已合入并可执行：Draw 2（414.1/414.3）与费用计划的 discounts 扣减路径；不可把两档折扣相加或硬编码其中一档。" +
    "依赖：静态费用效果的 Finalize 绑定与 Expr/Condition 的 controller-xp 读取。",
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
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
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
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 11 }
      }
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
