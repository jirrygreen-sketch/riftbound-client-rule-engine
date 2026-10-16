import type { CardProgram } from "../../ir/index.js";

/**
 * Perfect Execution（ven-012-166）— Spell，3 能量 + 1 点 Fury 力量，领域 Fury，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-012-166，逐字）：
 *   "Ready a unit and give it [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)\n[Flow] :rb_energy_3::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 「Ready a unit」：355.9.a.1 未特别说明时 “unit” 指 Board 上的单位；该单位由玩家在
 *   Finalize 选择（355.5.a 的同类示例），是目标（355.7/355.8）。重置动作交给已合入的
 *   effect.ready（416.1-416.3），它只提交 {type:"ready"} 动作，不伪造入场改写（369.3）。
 * - 「give it [Assault 3] this turn」：806 之外的 807 是 Assault 的被动关键词定义 ——
 *   807.1.c 功能上等价于 “While I am an attacker, I have +3 Might”；807.2/807.3 规定多个
 *   实例相加且“是否拥有 Assault”是可引用特征。801.3.a.2 让授予效果自带期限，本句期限为
 *   “this turn”（317.2.c 于回合结束清理时到期）。因此这是带 end-of-turn 期限的关键词授予
 *   （契约 3.7 的 continuous.grant-keyword / 调研表的 continuous.keyword），不是 +3 Might 的
 *   Might 修改，也不是 Buff 计数（702/703）。
 * - “it” 回指前一句的单位，与重置指令引用同一目标（359.3.e.14 的链接示例）。两条指令同属
 *   一个句子（“and”），本程序保留同一 TargetSpec 的符号选择器以表达同一对象。
 * - 「[Flow] :rb_energy_3::rb_rune_fury:」同 Brittle Steel 的判定（829.1.b/829.1.c.1）。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 关键词授予没有已合入原语：effects/instructions 没有 continuous.grant-keyword /
 *    continuous.keyword 文件（RIFT-9 清单项），layers 也没有消费“授予的关键词”的路径；
 *    把 Assault 3 写成 +3 Might 是 807.1.c 的近似实现（Assault 只在攻击者身份下生效，
 *    且 807.2 的加总语义不同），不写。
 * 2. Assault 自身的展开消费方未合入：keywords/Assault.ts 展开为 continuous.might +
 *    condition.predicate(designation eq attacker)，属于 RIFT-91 的层求值侧，目前只声明不执行。
 * 3. 印刷 Flow 费用送不进展开（契约 3.8.3 的 params.cost 未落地），Flow 消费方同
 *    Brittle Steel 的 RIFT-261/RIFT-260 依赖。
 * 已合入并真实执行：「Ready a unit」的 effect.ready（416.1/416.1.b/416.1.c），golden 用解释器 +
 * 参考内核执行横置单位被重置、已就绪单位不再重置（count 0）、目标失效（ignored）三个分支。
 * 依赖：continuous.keyword / grant-keyword 原语（RIFT-9）、RIFT-91、RIFT-261/RIFT-260。
 */
export default {
  canonicalCardId: "card.hash-9b9d80a33d320406e0f8cd8f3d1302432ecb3631b32fe7d448639224c253e235",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 关键词授予没有已合入原语：effects/instructions 没有 continuous.grant-keyword / " +
    "continuous.keyword（RIFT-9 清单项），layers 也没有授予关键词的消费路径；把 [Assault 3] 写成 +3 Might 是 807.1.c 的近似实现" +
    "（Assault 只在攻击者身份下生效，807.2 的加总语义也不同），故不写。" +
    "(2) Assault 的展开消费方未合入：keywords/Assault.ts 展开为 continuous.might + condition.predicate(designation eq attacker)，" +
    "RIFT-91 只合入了层求值侧。" +
    "(3) 印刷 Flow 费用（829.1.c：3 能量 + 1 点 Fury 力量）送不进展开——契约 3.8.3 的 params.cost 未落地，" +
    "Flow 的 flow.cost / replacement.event 消费方依赖 RIFT-261/RIFT-260（829.1.b.1）。" +
    "已合入并真实执行：「Ready a unit」的 effect.ready（416.1/416.1.b/416.1.c），golden 用解释器 + 参考内核断言横置被重置、已就绪不再重置、目标失效 ignored。" +
    "依赖：continuous.keyword（RIFT-9）、RIFT-91、RIFT-261、RIFT-260。",
  abilities: [
    // 829.1.a：Flow 在法术上；卡只声明关键词（展开见 judgeReason 第 3 条）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      // 印刷基础费用：3 能量 + 1 点 Fury 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Ready a unit」：416.1-416.3 的重置动作，目标为一张 Board 单位。
          id: "perfect-execution.ready-unit",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "perfect-execution.unit" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "readied" }
          },
          targets: [
            {
              id: "perfect-execution.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「give it [Assault 3] this turn」：带 end-of-turn 期限的关键词授予，引用同一目标
          // （“it”，359.3.e.14）。op 未注册（见 judgeReason 第 1 条），不近似成 Might 修改。
          id: "perfect-execution.grant-assault",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            amount: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "perfect-execution.unit",
              filter: { type: "unit", zone: "board" },
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
    "Ready a unit and give it [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)\n" +
    "[Flow] :rb_energy_3::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;
