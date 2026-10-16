import type { CardProgram } from "../../ir/index.js";

/**
 * Crumbling Sands（ven-039-166）— Spell，1 能量 + 1 点 Calm 力量，领域 Calm，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-039-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\nCounter a spell if an opponent has played another spell this turn."
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Reaction]」是 813 的许可类关键词（813.1.c：可在任意玩家的 Closed State 期间打出），
 *   卡文件只声明；展开（continuous.timing）与链的许可查询归 keywords/Reaction.ts 与 chain/。
 * - 「Counter a spell」：describe 426 —— 被反击的牌什么都不做、从链上清除、费用不退还
 *   （426.1.a-426.1.c）。355.9.a.2 规定未特别说明时 “spell” 指链上已完成 Finalize 的对象，
 *   所以目标是 Chain 上的 spell（355.9.b/c：355.9.c 的“不能是法术自身”由目标系统排除）。
 *   已合入的 effect.counter 原语正好提交该动作并保留 {type:"spell", zone:"chain"} 的目标集。
 * - 「if an opponent has played another spell this turn」是打出该法术时必须成立的强制要求
 *   （355.8：把法术放上链前所有目标选择必须合法；355.17 的强制要求须在此阶段满足；356 的
 *   Finalize 检查）。它统计“本回合对手打出的、除本卡以外的 spell”（135.2.b.7 说明指令可以
 *   引用 Finalize 期间发生的动作；132/119 的对象身份与排除本卡见 812.1.c 的同类“另一张牌”语义）。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 该门槛没有可求值的条件形状：契约 3.6/3.8 的条件与历史查询是分开的 —— Condition 只有
 *    always/never/compare/all/any/not/expression，没有事件历史谓词；而 condition.history 是
 *    **指令**（op），只产出链接值，不能作为 Requirement 的 condition 传给 Finalize 校验
 *    （chain/engine.ts 的 Finalize 只对 Requirement.condition 调用 context.test）；
 *    interpreter/history.ts 又只接受字面 PlayerId 与 action/timingPoint/player/object 五个字段，
 *    没有“对手”这一玩家选择器，也没有契约 3.8 的 exclude/objectFilter（“another spell” 需要排除
 *    本卡自身）。写成 always/expression 占位会让门槛失效，等于放宽 355.8 的打出条件，故不写。
 * 2. 卡牌程序 → 链的 Requirement/Restriction 生产接线未合入（同 sfd/ogn 的批次判定），
 *    [Reaction] 的 Closed State 时机许可（813.1.c）也还没有消费方（chain/engine.ts 的 canAct
 *    只认速度参数，不读 continuous.timing）。
 * 已合入并真实执行：「Counter a spell」的 effect.counter 本体（426.1-426.3 的清除与不退款）与
 * Chain 目标形状；golden 用解释器 + 参考内核执行真实反击，并覆盖非 Chain 目标与已离链目标
 * （359.3.e）两个边界。
 * 依赖：历史条件形状（事件历史 Condition / 契约 3.8 的 exclude、objectFilter）、
 * Requirement 生产接线与 Reaction 时机许可（RIFT-89/RIFT-90/RIFT-120）。
 */
export default {
  canonicalCardId: "card.hash-18fffa303c3fbeadfe9840b125d2a8b823e8734036743306d7428faf759c696d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「if an opponent has played another spell this turn」没有可求值的条件形状：" +
    "合并的 Condition 只有 always/never/compare/all/any/not/expression（没有事件历史谓词），" +
    "condition.history 只是产出链接值的指令、不能作为 Requirement.condition 被 Finalize 的 context.test 求值" +
    "（chain/engine.ts 只对 Requirement/Restriction 的 condition 求值）；interpreter/history.ts 也只接受字面 PlayerId 与 " +
    "scope/action/timingPoint/player/object 五个字段，既没有“对手”玩家选择器，也没有契约 3.8 的 exclude/objectFilter" +
    "（“another spell” 必须排除本卡自身）。写成恒真占位会让 355.8 的打出门槛失效，故不写。" +
    "(2) 卡牌程序 → 链的 Requirement/Restriction 生产接线与 [Reaction] 的 Closed State 时机许可（813.1.c）都未合入" +
    "（chain 的 canAct 只按速度参数判定，不读 continuous.timing）。" +
    "已合入并真实执行：「Counter a spell」的 effect.counter（426.1-426.3）与 {type:\"spell\", zone:\"chain\"} 目标形状" +
    "（355.9.a.2），golden 用解释器 + 参考内核执行真实反击并覆盖非 Chain 目标、已离链目标两个边界。" +
    "依赖：事件历史条件形状与契约 3.8 的 exclude/objectFilter、Requirement 生产接线与 Reaction 时机许可（RIFT-89/RIFT-90/RIFT-120）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷基础费用：1 能量 + 1 点 Calm 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      // 「if an opponent has played another spell this turn」是 355.8/355.17 的强制要求，
      // 但没有可求值的条件形状（见 judgeReason 第 1 条）：这里只记录待接线的 Requirement 形状，
      // 不写恒真条件冒充门槛。
      requirements: [
        {
          kind: "opponent-played-another-spell-this-turn",
          condition: {
            kind: "expression",
            value: {
              kind: "count",
              subject: "spells-played-by-opponents-this-turn",
              // 描述性过滤：合并匹配器不认这些键，故该条件 fail-closed（不会把门槛当成恒真）。
              filter: { zone: "chain", controller: "opponent", exclude: "self", otherThanSource: true }
            }
          }
        }
      ],
      body: [
        {
          // 「Counter a spell」：355.9.a.2 的 Chain 上已完成 Finalize 的对象；426.1-426.3 的
          // 清除与不退款由已合入的 effect.counter 提交。
          id: "crumbling-sands.counter-spell",
          op: "effect.counter",
          args: {
            target: { kind: "constant", value: "crumbling-sands.spell" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "crumbling-sands.spell",
              filter: { type: "spell", zone: "chain" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell if an opponent has played another spell this turn."
} satisfies CardProgram;
