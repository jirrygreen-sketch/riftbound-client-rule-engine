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
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
 */
export default {
  canonicalCardId: "card.hash-9b9d80a33d320406e0f8cd8f3d1302432ecb3631b32fe7d448639224c253e235",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（2026-10-17 RIFT-733 复核实测）：" +
    "(1) 授予的 Assault 3 缺动态关键词展开与角色谓词消费：continuous.grant-keyword 已把关键词写入 ability 层，" +
    "但 programs/lifecycle.ts 只在登记时绑定一次，不会按授予后的关键词变化重新展开 KeywordDef；" +
    "Assault.ts 展开的条件读 object-property \"designation\"，而已有的 ObjectSnapshot.combatRole 没有映射到该属性，" +
    "无法证明 807.1.c 的攻击时 +3 Might。" +
    "(2) 印刷 Flow 的 3 Energy + 1 Fury Power 没有承载通道：KeywordAbility 只有 keyword/value，" +
    "programs/keywords.ts 的 expandProgram 一律调 def.expand({ value, host })、不读 params.cost（契约 3.8.3），" +
    "Flow.ts 因此展开出不含 cost 的 flow.cost；" +
    "该静态效果在 programs/statics.ts 实测被拒（\"Static ability kind flow.cost has no layer mapping\"），" +
    "而其 object-leaves-chain replacement 在 replacement/bind.ts 实测抛 BlockedReplacementError " +
    "\"Unsupported replacement opcode: effect.banish\"，829.1.b.1 的已支付实例与离链放逐同样无消费路径。" +
    "effect.ready、continuous.grant-keyword 与到期移除已有真实执行证据；不近似实现这两处缺口。",
  abilities: [
    // 829.1.a：Flow 在法术上；卡只声明关键词（展开见 judgeReason 第 2 条）。
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
