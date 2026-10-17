import type { CardProgram } from "../../ir/index.js";

/**
 * Sacred Protector (ven-129-166) — Unit, 4 Energy + 1 Order Power, 6 Might,
 * Order, Fae/Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-129-166，逐字）：
 *   I don't deal combat damage unless I'm at a battlefield with exactly one
 *   other unit you control.
 *
 * 规则依据（CR v1.5）：
 * - 467.2.c.1.a：战斗伤害在分配完成后同时造成；本卡改写的是“本单位是否造成
 *   战斗伤害”，属持续性的战斗伤害限制（survey ability-templates 的
 *   continuous.combat 族），不是一次性效果。
 * - “at a battlefield with exactly one other unit you control” 是位置 + 数量条件：
 *   同地点（sameLocationAs 宿主）且控制者为你的其它单位恰好 1 个；用 count 表达式
 *   配 `exclude: "self"`（契约 3.6 的 ObjectSelector 形状）表达，由图层 / 战斗系统
 *   在造成战斗伤害前求值（契约 3.1 的 static ability 条件字段）。
 *
 * status = judge-required（复核 2026-10-16）：continuous.combat 原语已合入，
 * 但它对自己的文档边界仍然成立——没有 combat consumer 消费该图层行，原语在当前实现里
 * 返回 negated/impossible 而不是登记一条无行为的效果；战斗伤害执行器与战斗开始/伤害
 * 事务（combat/flow.ts 的 combat-start-transaction / simultaneous-damage-transaction）
 * 也尚未实现，因此“本单位不造成战斗伤害”（467.2.c.1.a）没有可执行路径。同时卡牌程序的
 * static 绑定与 combat 的 layerFor 映射已经合入（programs/statics.ts），但没有 combat 消费者读取图层。
 * 不近似实现（不用 effect.damage 造替代语义）；条件形状本身用已合入的 condition.predicate
 * 在 golden 中真实求值，count 的 sameLocationAs/exclude 锚点在解释器查询路径可用。
 */
export default {
  canonicalCardId: "card.hash-e99af0758d26984ed89173384615fc55536c8bab7b751efe428c2565832ff0f7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.combat 持续效果的可执行路径：467.2.c.1.a 的战斗伤害限制没有 combat consumer——" +
    "effects/instructions/continuous.combat.ts 已合入，但它在当前实现中对没有消费方的注册返回 " +
    "negated/impossible（不登记无行为的效果）；combat/flow.ts 的战斗开始与同时伤害事务仍主动抛 " +
    "combat-start-transaction / simultaneous-damage-transaction，因此本单位不造成战斗伤害仍没有执行路径。" +
    "programs/statics.ts 的 createEngineStaticBinder().bindStatic 与 layerFor 的 combat 映射已经合入，" +
    "但没有 combat 图层消费者读取该静态行；条件本身已由 golden 经合并解释器真实求值。" +
    "另外 staticFilter 的 exclude 键仍属 judge-required，但本卡的 condition.predicate 路径可用；不近似实现。" +
    "依赖：continuous.combat 的 combat consumer（战斗批次）、战斗开始/同时伤害事务与 combat 静态图层消费接线。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.combat",
        mode: "no-combat-damage",
        appliesTo: "self"
      },
      // “unless I'm at a battlefield with exactly one other unit you control”
      // （467、contract 3.4：条件只作用于所属能力）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "other-friendly-units-here",
          filter: {
            type: "unit",
            zone: "board",
            controller: "controller",
            sameLocationAs: "self",
            exclude: "self"
          }
        },
        operator: "eq",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "I don't deal combat damage unless I'm at a battlefield with exactly one other unit you control."
} satisfies CardProgram;
