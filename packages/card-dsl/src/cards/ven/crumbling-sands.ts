import type { CardProgram } from "../../ir/index.js";

/** CR v1.5 355.8/355.17、355.9.a.2、426、813.1.c。历史要求保留为未绑定的具名 Requirement，禁止用区域计数替代。 */
export default {
  canonicalCardId: "card.hash-18fffa303c3fbeadfe9840b125d2a8b823e8734036743306d7428faf759c696d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "355.8/355.17 的强制打出门槛仍缺可在 Finalize 求值的历史 Condition：“an opponent has played another spell this turn” 需要按对手、回合、spell 类型查询，并排除自身。condition.history 的 exclude/objectFilter 已支持，但它是指令，不能用作 Requirement.condition；历史 player 仍是字面 PlayerId，缺相对对手选择器（RIFT-359）。不能用当前区域对象 count 冒充历史门槛。",
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
