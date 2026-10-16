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
 * status = judge-required（四处依赖均不近似实现）：
 * 1. beginning-start 没有任何已合入的发出者进入唯一事件管线，也没有订阅方把 CardProgram 的
 *    triggered ability 注册成 TriggerRegistration（RIFT-120）。
 * 2. 临时 +2 Might 需要卡牌侧 continuous.might 指令原语与回合期限（RIFT-9 清单；RIFT-91 只合入
 *    图层求值侧），不能用 effect.buff 计数近似。
 * 3. [Ganking] 的授予需要带期限的 continuous.grant-keyword 指令原语；effects/instructions/
 *    下没有该 op（同 sfd/007-221 Gem Jammer、ven/147-166 Eye of Twilight 的记录）。
 * 4. "fewer runes than an opponent" 的量化在 3 名及以上玩家时不完整（现有 Condition/Expr 只能
 *    两两比较 count），见回复的契约变更请求。
 * 依赖：RIFT-120、continuous.might 与 continuous.grant-keyword 指令原语（RIFT-9/RIFT-91）、
 * Ganking 的移动许可消费方（zones/movement）。
 * 已支持部分：触发条件里的符文数量比较（133.5.a.1/431.1）由 golden 真实求值。
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
        // 143.2.a/475–477：临时 Might 修改归算术图层；卡牌侧 continuous.might 指令未合入。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: { kind: "constant", value: { kind: "source" } }
        }
      },
      {
        id: "oasis-raider.grant-ganking",
        // 810 的授予需要 continuous.grant-keyword 指令原语（effects/instructions 无该 op）；
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
    "四处依赖未合入：(1) beginning-start 时点（315.2.a.1）虽在封闭枚举中，但没有已合入的发出者把它发进唯一事件管线，" +
    "也没有订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-120）；" +
    "(2)「+2 :rb_might: this turn」是带回合期限的临时 Might 修改，需要卡牌侧 continuous.might 指令原语" +
    "（RIFT-9 清单；RIFT-91 只合入图层求值侧），不能用 Buff 计数近似（702/703）；" +
    "(3)「[Ganking] this turn」需要带 end-of-turn 期限的 continuous.grant-keyword 指令原语，" +
    "effects/instructions/ 下没有该 op（同 sfd/007-221 Gem Jammer、ven/147-166 Eye of Twilight 的记录）；" +
    "(4)「fewer runes than an opponent」在 3 名及以上玩家时需要 exists 量化，现有 Condition/Expr 只能两两比较 count，" +
    "本程序按两对局形状记录（见回复的契约变更请求）。触发条件的符文数量比较（133.5.a.1/431.1）由 golden 真实求值。" +
    "依赖：RIFT-120 与 continuous.might / continuous.grant-keyword 指令原语。不近似实现。",
  abilities,
  sourceText:
    "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
    "+2 :rb_might: and [Ganking] this turn. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
