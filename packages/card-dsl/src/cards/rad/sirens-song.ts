import type { CardProgram } from "../../ir/index.js";

/**
 * Siren's Song（rad-098-167）— Spell，2 能量，无印刷力量，领域 Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-098-167，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Move an enemy unit that moved this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Move an enemy unit that moved this turn」是效果移动（451）：被移动的敌方单位是目标
 *   （355.10 / 355.9.a.1），目标过滤需要「本回合移动过」这一历史谓词（449 的 Moving；
 *   history 计数由 context.history 提供，契约 3.6）；原文没有印刷目的地，目的地按 355.4 /
 *   355.4.a 在结算时选择（451.1）。
 *
 * status = judge-required（不近似实现），按已合入的 Reaction、effect.move 与 LocationExpr
 * 复核：
 * 1. 目的地是运行期选择（355.4 / 355.4.a / 451.1）：LocationExpr 已能让 effect.move
 *    求值可用候选地点，但合并的候选来源没有注入空战场，因此所有合法落点仍未形成完整生产链；
 *    本卡保留该边界，不落到错误地点。
 * 2. 「that moved this turn」需要移动历史谓词：HistoryQuery（契约 3.6 / 3.8）可用于指令
 *    与触发条件，但目标过滤器没有 moved-this-turn 谓词，无法在 Finalize 用它限制目标
 *    合法性（355.9.b）；object-moved 时点本身已由 events/action-adapter.ts 发出，
 *    缺的是把该历史接进 TargetSpec filter 的谓词词汇。
 * 3. [Reaction] 关键词（keywords/Reaction.ts）与 effect.move 原语本身已合入，
 *    被移动的敌方单位按 355.10 / 355.9.a.1 声明为目标。
 *
 * 依赖：目标过滤器的移动历史谓词与完整的运行期 Location 候选来源。
 */

/** 355.4 / 355.4.a 的运行期 Location 选择；候选来源缺口见 judgeReason。 */
const CHOSEN_LOCATION = {
  kind: "choose",
  id: "sirens-song.location-destination",
  filter: { type: "any" }
} as const;

const sirensSong = {
  canonicalCardId: "card.hash-4192b981ea612f380ed34cb8529363e9618f8f512b964c7c2d22a1323d4ef7e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 没有印刷目的地——已按 CR 355.4 / 355.4.a / 451.1 写成" +
    "LocationExpr 运行期选择，但候选来源没有注入空战场，所有合法落点尚未形成完整生产链。" +
    "(2)「an enemy unit that moved this turn」的目标合法性" +
    "需要移动历史谓词（CR 449 / 355.9.b）：HistoryQuery 只作用于指令/触发条件，" +
    "目标过滤器没有 moved-this-turn 谓词（object-moved 时点本身已由事件管线发出）。" +
    "被移动的敌方单位已按 355.10 / 355.9.a.1 声明为目标；[Reaction] 关键词与 effect.move 原语本身已合入。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "sirens-song.move-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "sirens-song.moved-enemy-unit" }
            },
            to: { kind: "location", value: CHOSEN_LOCATION },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "sirens-song.moved-enemy-unit",
              // controller / movedThisTurn 是待接线声明：参考内核与本阶段过滤器按值比较，
              // movedThisTurn 谓词尚未合入（见 judgeReason 第 2 点）。
              filter: { type: "unit", controller: "opponent", movedThisTurn: true },
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
    "Move an enemy unit that moved this turn."
} satisfies CardProgram;

export default sirensSong;
