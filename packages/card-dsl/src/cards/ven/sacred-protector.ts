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
 * status = judge-required：卡程序按契约写出该持续效果的有依据形状，但
 * effects/instructions/ 与 layers 没有消费方——封闭 GameAction 集合没有“限制战斗
 * 伤害”的动作，也没有卡牌侧 continuous.combat 原语的注册入口（RIFT-9 清单中的
 * continuous.combat 族，survey 第 4 节），战斗伤害执行器只读取已合入的语义注册表
 * （combat/derived-might.ts 的 self-Assault/self-Shield 通道）。依赖 RIFT-91（layers
 * 接线）与 continuous.combat 原语；不近似实现（不用 effect.damage 造替代语义）。
 * 条件形状本身用已合入的 condition.predicate 在 golden 中真实求值。
 */
export default {
  canonicalCardId: "card.hash-e99af0758d26984ed89173384615fc55536c8bab7b751efe428c2565832ff0f7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.combat 持续效果的可执行路径：467.2.c.1.a 的战斗伤害限制既不在封闭 GameAction " +
    "集合内，effects/instructions/ 下也没有 continuous.combat / 战斗伤害限制原语，卡牌程序无法把该" +
    "静态效果注册进 layers（ctx.addContinuous 目前只有 chain/engine 内部接线），战斗伤害执行器只读取" +
    "已合入的语义注册表（combat/derived-might.ts 的 self-Assault/self-Shield 通道）。依赖 RIFT-91" +
    "（layers 接线）与 RIFT-9 清单中的 continuous.combat 原语。程序已按契约写出有依据的静态效果形状" +
    "（ability 级 condition：count + sameLocationAs + exclude），不近似实现。",
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
