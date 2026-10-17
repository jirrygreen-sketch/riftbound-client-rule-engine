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
 * status = judge-required（复核 2026-10-17；缺口均不近似实现）：
 * 1. 关键词授予原语已合入：continuous.grant-keyword 以 ability 层注册
 *    buildKeywordGrantSpec，本卡的 grant 指令由 golden 用真实原语 + 参考内核执行，
 *    并经 LayerEngine 断言目标获得 Assault 3（806 之外的 807 是 Assault 的被动关键词定义）。
 * 2. Assault 自身的展开消费方未合入：keywords/Assault.ts 展开为 continuous.might +
 *    condition.compare(object-property self "designation" eq "attacker")；对象快照已有
 *    combatRole，但 combatRole→designation 的层查询映射仍未接线，所以 “+3 while it's an
 *    attacker” 的层求值仍不可执行（层条件目前对未知谓词 fail-open，绝不能当作已实现）。
 * 3. Flow 的 KeywordDef 已接受契约 3.8.3 的 params.cost，但 KeywordAbility/卡牌程序的
 *    消费方仍未把印刷 Flow 费用转发到 expand；flow.cost / replacement.event 的消费方依赖
 *    仍缺 Flow alternate-cost 与离链 replacement 的消费接线（829.1.b.1）。
 * 已合入并真实执行：「Ready a unit」的 effect.ready（416.1/416.1.b/416.1.c），golden 用解释器 +
 * 参考内核执行横置单位被重置、已就绪单位不再重置（count 0）、目标失效（ignored）三个分支；
 * 「give it [Assault 3] this turn」的 grant 指令（801.3.a.2 的 end-of-turn 期限）由
 * continuous.grant-keyword 真实注册。
 * 依赖：combatRole→designation 谓词接线（RIFT-359）、Flow alternate-cost / replacement 消费接线。
 */
export default {
  canonicalCardId: "card.hash-9b9d80a33d320406e0f8cd8f3d1302432ecb3631b32fe7d448639224c253e235",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) Assault 的展开消费方未合入：keywords/Assault.ts 展开为 continuous.might + " +
    "condition.compare(object-property self \"designation\" eq \"attacker\")；ObjectSnapshot 已有 combatRole，" +
    "但 combatRole→designation 的层查询映射仍未接线，所以「+3 while it's an attacker」（807.1.c）的层求值仍不可执行" +
    "（依赖 RIFT-359/战斗角色谓词接线）；(2) Flow 的 KeywordDef 已接受契约 3.8.3 的 params.cost，" +
    "但 KeywordAbility/卡牌程序消费方仍未把印刷 Flow 费用（829.1.c：3 能量 + 1 点 Fury 力量）转发到 expand，" +
    "且 flow.cost / replacement.event 消费方仍未接线（829.1.b.1）。" +
    "已合入并真实执行：「Ready a unit」的 effect.ready（416.1/416.1.b/416.1.c），golden 用解释器 + 参考内核断言横置被重置、" +
    "已就绪不再重置、目标失效 ignored；「give it [Assault 3] this turn」（801.3.a.2 的 end-of-turn 期限）由已合入的 " +
    "continuous.grant-keyword 用真实原语注册，golden 再经 LayerEngine 断言目标获得 Assault 3。" +
    "依赖：RIFT-359（combatRole→designation 谓词接线）、Flow alternate-cost / replacement 消费接线。",
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
          // （“it”，359.3.e.14）。执行证据见 judgeReason：grant 指令已由 continuous.grant-keyword 真实注册。
          id: "perfect-execution.grant-assault",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "perfect-execution.unit" } }
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
