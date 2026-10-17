import type { CardProgram } from "../../ir/index.js";

/**
 * Soul Harvest (unl-159-219) — Spell, 2 energy + 1 Order power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-159-219，逐字):
 *   Kill a unit at a battlefield with 3 :rb_might: or less.
 *
 * 规则依据（CR v1.5）:
 * - 没有 [Action]/[Reaction] 印刷线：法术按内在时机默认 Action（159.2.a）。
 * - 「Kill a unit …」是 429.1.a.1.a 的 Active Kill（消灭指令，429.1.a.1.a），
 *   由已合入的 effect.kill 提交 kill 动作；429.5 的归因与死亡时点归引擎。
 * - 「a unit at a battlefield」：355.9.a.1 / 355.10.b 规定「Kill a unit at a
 *   battlefield」以单位为唯一目标，而「at a battlefield」只是该目标的 location
 *   限制（不额外指向战场）。限制用已合入图层匹配器认识的 location 拼写
 *   （layers/filter.ts 接受 location 名或精确 Location）。
 * - 「with 3 :rb_might: or less」是 355.9.b 的 targeting restriction，需要读取
 *   143.2.a 的有效 Might 并做阈值比较；355.9.b 的示例正是「unit with Might 4 or
 *   greater」。该限制在 Finalize 与 Resolve 都要重验（355.9.b、359.3.e）。
 *
 * status: judge-required —— Might 上限谓词未合入：冻结 ObjectFilter 没有数值比较，
 * 已合入过滤器（layers/filter.ts 的 matchesObjectFilter、测试内核的 matchesQueryFilter/
 * matchesFilter）只按 type/zone/location/controller/owner/tags/characteristics 等字段匹配，
 * 未知键（本文件的 mightLte）会被静默忽略——实测 7 Might 的战场单位与 2 Might 的战场单位
 * 在 matchesObjectFilter 下同样通过该 filter——把它当已实现会让 Soul Harvest 能消灭
 * 任意战场单位。Mighty 关键词的阈值谓词（effects/keywords/Mighty.ts 的 mightyCondition，
 * 708/710）已可用 condition.predicate 求值，但 TargetSpec.filter 不消费 Condition。
 * effect.kill 本体与 location 限制在 golden 中对锁定目标真实执行；精确的 Might 阈值不近似实现。
 *
 * 依赖：TargetPlan/TargetSpec 的有效 Might 阈値谓词（RIFT-359）。
 */
const program = {
  canonicalCardId: "card.hash-1874eb10cc2af76bced76159e28914196dd012c232435193372275264084a018",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺「3 :rb_might: or less」的目标谓词：355.9.b / 355.10.b 规定「Kill a unit at a battlefield with 3 Might or less」" +
    "以单位为唯一目标、location 只是限制，但 143.2.a 的有效 Might 阈值比较在冻结 ObjectFilter 与已合入过滤器" +
    "（layers/filter.ts 的 matchesObjectFilter、测试内核的 matchesQueryFilter/matchesFilter）中没有实现——未知键" +
    "（本文件的 mightLte）会被静默忽略：实测 7 Might 与 2 Might 的战场单位在 matchesObjectFilter 下同样通过该 filter，" +
    "把它当已实现会让本卡消灭任意战场单位。Mighty 关键词的阈值谓词（effects/keywords/Mighty.ts 的 mightyCondition，708/710）" +
    "已可用 condition.predicate 求值，但 TargetSpec.filter 不消费 Condition。effect.kill（429.1.a.1.a）与 location 限制" +
    "已合入并在 golden 中真实执行；整卡因阈值谓词保持 judge-required，不近似实现。依赖：TargetPlan/TargetSpec 的有效 Might" +
    "阈值谓词（RIFT-359）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "soul-harvest.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "soul-harvest.battlefield-unit" } },
          targets: [
            {
              id: "soul-harvest.battlefield-unit",
              filter: {
                type: "unit",
                zone: "board",
                location: "battlefield",
                // 描述性占位：见 judgeReason，尚无 Might 阈值谓词消费方。
                mightLte: 3
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Kill a unit at a battlefield with 3 :rb_might: or less."
} satisfies CardProgram;

export default program;

