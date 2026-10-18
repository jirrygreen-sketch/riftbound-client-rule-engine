import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Oasis Raider (ven-006-166) — Unit, Fury, tag Shurima.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-006-166，逐字）：
 *   If you control fewer runes than an opponent at the start of your Beginning Phase,
 *   give me +2 :rb_might: and [Ganking] this turn. (I can move from battlefield to
 *   battlefield.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 315.2.a / 315.2.a.1：Beginning Step 开始时结算游戏效果，对应封闭时点 beginning-start；
 *   "your" 指本卡控制者的回合（filter.player: "self"）。
 * - 383.2.a / 383.2.a.1：条件从句 "If you control fewer runes than an opponent" 属触发条件。
 * - 133.5.a.1 / 431.1：符文区（"rune-zone"）里的 rune 数量即「你控制的符文数」。
 * - "give me +2 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （143.2.a、475–477），不是 Buff 计数器（702/703）。
 * - "give me ... [Ganking] this turn"：810.1/810.1.b 的 Ganking 是「我可以从战场移动到
 *   另一个战场」的被动能力关键词（810.1.c 是给 Standard Move 增加许可，810.2 多重实例冗余）。
 *   授予一个关键词、且只有本回合有效，属 continuous.grant-keyword 的图层授予（契约 3.7 的
 *   KeywordDef.expand 输出 Ability，卡文件只声明意图、不重写 Ganking 的展开）。
 * - 053.1/355.10.g："me" 是能力宿主自身，不是目标。
 *
 * status = judge-required：beginning-start 的发出与 CardProgram triggered 注册、符文数量条件、
 * continuous.might 和 continuous.grant-keyword 的图层注册均已可执行；默认 CardProgram/ChainEngine
 * 仍缺动态授予的 Ganking 关键词重绑定为 continuous.movement，以及该许可到 Standard Move 的生产接线。
 * 不把当前 1v1 TurnFlow 之外的多人量化当作本卡缺口，也不用 Buff 计数近似 Might。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "beginning-start",
      filter: { event: "beginning-start", player: "self" },
      // 383.2.a.1：紧跟时机从句的条件属触发条件。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "self", zone: "rune-zone" }
        },
        operator: "lt",
        right: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "opponent", zone: "rune-zone" }
        }
      }
    },
    optional: false,
    body: [
      {
        id: "oasis-raider.plus-2-might",
        // 143.2.a/475–477：临时 Might 修改归算术图层；使用已注册的 continuous.might 原语。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: { kind: "constant", value: { kind: "source" } }
        }
      },
      {
        id: "oasis-raider.grant-ganking",
        // 810 的授予使用 continuous.grant-keyword；动态关键词展开仍有缺口。
        // 两条指令作用于同一宿主但彼此没有结果依赖，因此不写 linkedTo（契约 3.2）。
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Ganking" },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: { kind: "constant", value: { kind: "source" } }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-53cec70ec57166a99b31590256f5edbab3c1ad0c9a311a661db2a5672c4ac0e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一未完成的能力是动态 Ganking 的移动许可消费（810.1.b / 810.1.c）：" +
    "continuous.grant-keyword 已向宿主能力图层授予本回合有效的 Ganking，但默认 " +
    "CardProgram/ChainEngine 路径没有在结算后重绑 KeywordDef 为 continuous.movement；实测图层关键词存在，而 movement() 的 " +
    "canGank 仍为 false。beginning-start、符文数量比较、continuous.might、关键词授予与到期均有真实执行证据，" +
    "不能用静态 Ganking 或 Buff 计数替代该动态许可。",
  abilities,
  sourceText:
    "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
    "+2 :rb_might: and [Ganking] this turn. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
