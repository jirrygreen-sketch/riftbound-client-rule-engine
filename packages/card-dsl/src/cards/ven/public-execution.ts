import type { CardProgram } from "../../ir/index.js";

/**
 * Public Execution (ven-154-166) — Spell, 2 Energy + 1 Body/Order Power, tags
 * Ambessa/Signature. Might null（法术没有印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-154-166，逐字）:
 *   "Choose a friendly unit. Kill an enemy unit with less Might than it.
 *    [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this
 *    from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）:
 * - 「Choose a friendly unit」：玩家指名一个己方单位，因此是目标（355.7；355.9.b 的限制、
 *   355.10.b 的对照示例都按“按特征选择、不符合例外”处理）；选择在 Finalize 完成（355.5/355.8），
 *   结算时按 359.3.e 重验。
 * - 「Kill an enemy unit with less Might than it」：第二个目标，其合法性限制是对第一个目标的
 *   相对 Might 比较（355.9.b 的"按限制选择"；有效 Might 的读法见 143.2.a）。比较在目标选择时
 *   （Finalize）必须成立，而不是结算时才判定；359.3.e.2 还要求在结算时再次确认它仍满足该限制。
 * - 已合入的 effect.kill（429.1/429.2.a/429.6 的主动消灭动作）提交封闭的 kill 动作；消灭归因
 *   （429.5）与时点由内核负责。
 * - [Flow]（829）是费用改写关键词：印刷费用为 5 Energy + 2 rainbow Power。展开归
 *   effects/keywords/Flow，本卡只声明关键词。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const publicExecution = {
  canonicalCardId: "card.hash-c0e71d5f247d83c5854d4a20f7ece28e38086a6726e768eae11da9b47b22991b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两段接线：(1) CR 355.9.b/143.2.a 的相对有效 Might 目标限制 mightLessThanTarget 尚未进入 programs/filters.ts 的允许字段或 target/target-plan.ts 合法性谓词；结算期 compare 已支持，但不能替代 Finalize 的目标限制。(2) Flow KeywordDef 与费用计划的 baseModifications.kind=flow 已合入，KeywordDef 接受 params.cost；卡程序 KeywordAbility 和 programs/keywords.ts 仍不传递本卡印刷的 5 Energy + 2 [A]。flow.cost 静态能力没有绑定到 Trash 打出许可及替代费用，829.1.b.1 的 Flow 实例选择回执和自身指令离链例外也未接入延迟放逐；通用 replacement 绑定存在不等于该 Flow 记录已被消费。effect.kill 与结算期相对 Might compare 仅有解释器子效果证据；RIFT-682 保留原始目标限制的整卡场景为 TODO，不能删除限制换取测试台通过。不近似实现。",
  abilities: [
    // 829.1 / 829.1.c：印刷的 [Flow] 替代费用关键词，只声明不重写展开。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // 「Choose a friendly unit. Kill an enemy unit with less Might than it.」：两个目标都在
          // Finalize 选择（355.5/355.8/355.12），因此两条 TargetSpec 挂在这一条 kill 指令上。
          id: "public-execution.kill-lesser-enemy",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "public-execution.enemy-unit" } },
          targets: [
            {
              id: "public-execution.friendly-unit",
              // 「a friendly unit」= 能力控制者控制的 Board 单位（355.9.a.1 的 "unit" 指 Board 对象）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "public-execution.enemy-unit",
              // 「an enemy unit」：对手控制的 Board 单位。「with less Might than it」是相对
              // Might 限制（143.2.a / 355.9.b），以描述性键 mightLessThanTarget 保留——
              // 没有任何已合入目标谓词求值它（见 judgeReason 第 1 点），因此该目标当前不会
              // 被合法 Finalize，绝不当成已实现。
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                // 描述性相对限制："with less Might than it"（143.2.a / 355.9.b）。
                mightLessThanTarget: "public-execution.friendly-unit"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          // 359.3.e.2：结算时再次确认目标仍满足限制；用已合入的对象特征读取表达同一比较，
          // 不满足时该指令不执行（不把“消灭任意敌方单位”写成事实）。
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "public-execution.enemy-unit" },
              property: "might"
            },
            operator: "lt",
            right: {
              kind: "object-property",
              object: { target: "public-execution.friendly-unit" },
              property: "might"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose a friendly unit. Kill an enemy unit with less Might than it.\n" +
    "[Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default publicExecution;
