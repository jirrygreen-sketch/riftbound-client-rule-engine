import type { CardProgram } from "../../ir/index.js";

/**
 * Crescent Strike (unl-072-219) — Spell, 3 energy, 1 power (Mind), no Might,
 * Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-072-219，逐字）：
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "Choose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to
 *    each other enemy unit there."
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Choose a battlefield」：按 355.10.d 的示例（"Kill all units at a battlefield"
 *   以战场为目标、单位不是目标），被选中的战场是目标（355.7 / 355.9）。
 * - 「and an enemy unit there」：该敌方单位由玩家选择（355.5），是目标；"there"
 *   是相对已选战场的目标限制（355.10.b 的 "at a battlefield" 同型），用
 *   sameLocationAs 锚点指向战场 TargetSpec。
 * - 「Deal 4 to that unit」：已合入的 effect.damage 以 TargetSpec 为目标，可执行。
 * - 「1 to each other enemy unit there」：按 355.10.d 这是按特征程序化选出的集合
 *   （除主目标外的该战场所有敌方单位，玩家对这些单位没有选择），不是目标；
 *   "other" 排除主目标，用 exclude 锚点表达。
 *
 * Status: judge-required. Current source audit:
 * effect.damage supports the chosen unit. The other-enemy set must remain
 * non-targeted. Interpreter query anchors and target.location are available,
 * but the authored relative object filter still lacks a program adapter.
 */
const crescentStrike = {
  canonicalCardId: "card.hash-f7adf9f6506b55f668b24e077add9d1252841ee4cbb74fb432903d6cfc842c88",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 effect.damage 的非目标集合消费：CR 355.10.d 的 each other enemy unit there 不能改成 TargetSpec；该原语仍只接受 target。解释器已能消费 sameLocationAs/exclude 查询锚点，target/location 也已有地点选择与重验，但 programs/filters.ts 的 translateObjectFilter 仍不接受本卡 sameLocationAs 目标过滤器，尚缺战场与单位联合选择的 Finalize 绑定及 CR 355.11 的 there 关系重验。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "crescent-strike.deal-4",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "crescent-strike.enemy-unit" }
          },
          targets: [
            {
              id: "crescent-strike.battlefield",
              // 355.10.d：被选中的战场是目标。
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "crescent-strike.enemy-unit",
              // 355.10.b："there" 是目标限制，不是第二个目标。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: { target: "crescent-strike.battlefield" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "crescent-strike.deal-1-to-others",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 1 },
            // 355.10.d 的非目标集合（见 judgeReason）：该战场除主目标外的所有敌方
            // 单位；sameLocationAs 指向已选战场，exclude 排除主目标。effect.damage
            // 尚未消费 objects，因此该指令不可执行。
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  zone: "board",
                  controller: "opponent",
                  sameLocationAs: { target: "crescent-strike.battlefield" },
                  exclude: { target: "crescent-strike.enemy-unit" }
                }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Choose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to each other enemy unit there."
} satisfies CardProgram;

export default crescentStrike;
