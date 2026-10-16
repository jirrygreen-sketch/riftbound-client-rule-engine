import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Forsaken Baccai (ven-005-166) — Unit, Fury, tag Shurima.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-005-166，逐字）：
 *   If you control fewer runes than an opponent at the start of your Beginning Phase,
 *   give me +1 :rb_might: this turn.
 *
 * 规则依据（Core Rules v1.5）：
 * - 315.2.a / 315.2.a.1：Beginning Phase 的 Beginning Step 开始时结算游戏效果，对应封闭时点
 *   beginning-start（events/timing-points.ts，ruleRefs 315.2.a.1）；"your" 指本卡控制者的
 *   回合，程序用 filter.player: "self" 记录该归属（与 ogn/loose-cannon 同写法）。
 * - 383.2.a / 383.2.a.1：条件从句构成触发条件；本句的 "If you control fewer runes than an
 *   opponent" 与时机从句同时给出触发成立所需的信息，写成 trigger.condition。
 * - 133.5.a.1 / 431.1：被 channel 的符文留在控制者的符文区（zone "rune-zone"），
 *   "you control fewer runes" = 控制者符文区的 rune 数量。
 * - 190.6.d："you" 是能力控制者；因此 "an opponent" 是相对该控制者的对手。
 * - "give me +1 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （143.2.a、475–477）；effect.buff 文件头明确临时 Might 修改归 continuous.might，
 *   不是 Buff 计数器（702/703）。"me" 是能力宿主（053.1/355.10.g 的自身指代，不是目标）。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. beginning-start 没有已合入的发出者：链层只把它用于清理时钟，回合/阶段流程未把该时点
 *    发进唯一事件管线，也没有订阅方把 CardProgram 的 triggered ability 注册成
 *    TriggerRegistration（RIFT-120，契约 §7.2 批 5）。
 * 2. "give me +1 :rb_might: this turn" 需要卡牌侧的 continuous.might 指令原语与回合期限：
 *    layers 引擎（RIFT-91）能求值 arithmetic 层与 end-of-turn 期限，但 effects/instructions/
 *    下没有该 op；不能用 effect.buff 计数近似。
 * 3. "fewer runes than an opponent" 的量化在多于两名玩家时不完整：现有 Condition/Expr 只能
 *    比较两个 count（控制者符文数 vs 某一对手的符文数），无法表达 135.x/190.x 语境下
 *    「存在一个符文更多的对手」。本程序按两名玩家的对局形状记录该比较，并在回复中登记该
 *    契约变更请求（多人模式的 exists 量化）。该比较本身可由解释器真实求值。
 * 依赖：RIFT-120（beginning-start 发射与卡牌触发注册）、continuous.might 指令原语
 * （RIFT-9 清单；RIFT-91 求值侧已合入）、多人量化契约变更。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "beginning-start",
      filter: { event: "beginning-start", player: "self" },
      // 383.2.a.1：触发条件里的符文数量比较。
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
        id: "forsaken-baccai.plus-1-might",
        // 临时 Might 修改（143.2.a/475–477）：卡牌侧 continuous.might 指令未合入
        // （RIFT-9 清单；RIFT-91 只合入图层求值侧），不使用 effect.buff 近似。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          // "me"：053.1 的自身指代，能力宿主，不是目标（355.10.g）。
          objects: { kind: "constant", value: { kind: "source" } }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-6f947454591d22ba8b13d37e0096d52966b2aa026047f0a31cb9dd1d80addb64",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) beginning-start 时点（315.2.a.1）虽在 events/timing-points.ts 的封闭枚举中，" +
    "但没有已合入的发出者把该时点发进唯一事件管线，也没有订阅方把 CardProgram 的 triggered ability 注册成 " +
    "TriggerRegistration（RIFT-120，契约 §7.2 批 5）；" +
    "(2)「give me +1 :rb_might: this turn」是带回合期限的临时 Might 修改，属算术图层，需要卡牌侧的 " +
    "continuous.might 指令原语（RIFT-9 清单；RIFT-91 只合入图层求值侧），不能用 Buff 计数（702/703）近似；" +
    "(3)「fewer runes than an opponent」的量化只在两名玩家时等于「我的符文数 < 对手的符文数」，" +
    "现有 Condition/Expr 不能表达 3 名及以上玩家时的「存在一个符文更多的对手」，本程序按两对局形状记录比较" +
    "（见回复的契约变更请求）。触发条件里的符文数量比较（133.5.a.1/431.1）本身由 golden 真实求值。" +
    "依赖：RIFT-120 与 continuous.might 指令原语。不近似实现。",
  abilities,
  sourceText:
    "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
    "+1 :rb_might: this turn."
} satisfies CardProgram;
