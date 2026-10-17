import type { CardProgram } from "../../ir/index.js";

/**
 * CR v1.5 355.8/355.17、355.9.a.2、426、813.1.c。历史要求保留为未绑定的具名 Requirement，禁止用区域计数替代。
 *
 * 复核（2026-10-17，M2 覆盖率复核）：RIFT-359 的 Condition 增补（played-from-hand /
 * played-from-zone / event-printed / result）已合入，但不覆盖本卡的门槛，缺口仍然成立。
 */
export default {
  canonicalCardId: "card.hash-18fffa303c3fbeadfe9840b125d2a8b823e8734036743306d7428faf759c696d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "355.8/355.17 的强制打出门槛仍缺可在 Finalize 求值的历史 Condition：" +
    "“an opponent has played another spell this turn” 需要按对手、本回合、spell 类型查询打牌历史，并排除本卡自身。" +
    "现状与实测：HistoryQuery 已支持 scope/action/timingPoint/exclude/objectFilter（contract.ts），" +
    "其 exclude/objectFilter 足以表达“another …”与“spell”两项，但 condition.history 是已注册的 body 指令" +
    "（interpreters dispatch 的 \"condition.history\" 分支，读 ctx.history），不是 Condition 的一种，" +
    "无法用作 Requirement.condition；programs/play.ts 的 translateRequirements 只接受 " +
    "always/never/compare/all/any/not/expression 六种 kind 或自带 condition，其余一律 " +
    "judgeRequired（实测 describePlay 抛 “requirement … kind opponent-played-another-spell-this-turn needs a " +
    "rules adapter”）。RIFT-359 新增的 played-from-hand / played-from-zone / event-printed / result 谓词都" +
    "以触发事件载荷为输入，不查询打牌历史，也不提供相对对手选择器（HistoryQuery.player 仍是字面 PlayerId，" +
    "IR 无法命名运行时对手）。不能用当前区域对象 count 冒充历史门槛。" +
    "已合入并用真实内核执行验证的部分：[Reaction] 的 Closed State 许可（canAct 实测 true）与 " +
    "effect.counter 的 426.1-426.3 清除及 355.9.a.2 的 Chain 目标限制。",
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
      // 历史门槛不能用当前区域 count 代替；保留具名要求供条件适配器绑定。
      requirements: [{ kind: "opponent-played-another-spell-this-turn" }],
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
