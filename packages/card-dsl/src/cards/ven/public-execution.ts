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
 * status = judge-required（见 judgeReason）：目标选择时的相对 Might 限制没有可求值谓词，
 * 因此该目标当前不能被合法 Finalize；程序保留描述性限制键，并把同一个比较写成指令级 condition
 * （结算时重验，359.3.e.2），绝不把限制去掉（去掉会变成“消灭任意敌方单位”）。
 */
const publicExecution = {
  canonicalCardId: "card.hash-c0e71d5f247d83c5854d4a20f7ece28e38086a6726e768eae11da9b47b22991b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1)「an enemy unit with less Might than it」的目标合法性限制没有可求值谓词：" +
    "355.9.b / 355.8 要求在 Finalize 选择目标时就满足该限制（143.2.a 的有效 Might 比较），" +
    "但冻结的 ObjectFilter 没有 Might 谓词，已合入的过滤器（layers/filter.ts 的 matchesObjectFilter、" +
    "测试内核的 matchesFilter）只按 type/zone/controller/tags/characteristics 等字段匹配，" +
    "未知键（程序里的 mightLessThanTarget）被忽略——把它当已实现会让本卡能消灭任意敌方单位。" +
    "依赖：目标计划的相对特征谓词与有效 Might 读取（RIFT-90 target/链，143.2.a/355.9.b）。" +
    "(2) 印刷的 [Flow] :rb_energy_5::rb_rune_rainbow::rb_rune_rainbow:（829.1.c.1/.c.2）没有已合入的" +
    " KeywordDef 与之接线（RIFT-266 的 Flow 展开仍在独立分支；契约 3.1 的 KeywordAbility 也没有承载印刷" +
    " Flow 费用的字段，已上报契约变更请求），因此“从弃牌区按其 Flow 费用打出、然后放逐”的许可与替代结算缺失。" +
    "已合入部分：effect.kill 本体（429.1/429.2.a）与两目标锁定后的相对 Might 比较（143.2.a 的有效 Might 读法）" +
    "由 golden 用真实原语执行；相对比较写成指令级 condition（359.3.e.2 的结算重验），不近似目标期限制。",
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
