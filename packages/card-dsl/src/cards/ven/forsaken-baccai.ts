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
 *   回合，程序用 filter.player: "self" 记录该归属。
 * - 383.2.a / 383.2.a.1：条件从句构成触发条件，写成 trigger.condition。
 * - 133.5.a.1 / 431.1：被 channel 的符文留在控制者的符文区（zone "rune-zone"）。
 * - 190.6.d："you" 是能力控制者；"an opponent" 是相对该控制者的对手。
 * - "give me +1 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （143.2.a、475–477）；effect.buff 文件头明确临时 Might 修改归 continuous.might。
 *
 * status = judge-required（2026-10-18 复核，四处当前缺口，均为实测，不近似实现）：
 * 1. 触发过滤器无法注册：卡牌写 { event: "beginning-start", player: "self" }，但
 *    EVENT_PATTERN_TYPES 只列事件类名、没有 beginning-start，实测
 *    EventPipeline.registerTrigger 抛 TriggerSpecValidationError（trigger.filter.event）。
 *    空 filter 是合法的，但实测 matchesTriggerEvent({}, beginning-start/player B, controller A)
 *    为 true——会连对手的 Beginning Phase 一起订阅，丢掉 "your" 的限定。
 * 2. 触发条件没有相对玩家归一化：实测参考内核的 test() 把符号 "self"/"opponent" 当字面值
 *    比较（条件恒 false），绑定成绝对玩家 id 后才成立；condition 走的是
 *    PipelineHost.testTrigger → 内核 test()，chain/engine.ts 只包装 query 的 controller/owner。
 * 3. 多人对局还缺“存在一个符文更多的对手”的 exists 量化：三处条件无法只用一次两两 count
 *    比较表达，把所有对手的符文总数当作某一对手的数量会算错。
 * 4. beginning-start 时点本身有发射方（turn/flow.ts），但上述注册失败使能力无法订阅它。
 * continuous.might 与单次触发本体已有执行证据。
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
        // 临时 Might 修改（143.2.a/475–477）：使用已合入的 continuous.might 原语。
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
    "四处当前缺口（2026-10-18 复核，均为实测）：(1) 卡牌声明的 { event: \"beginning-start\", player: \"self\" } 不在 " +
    "EVENT_PATTERN_TYPES 的封闭词汇里（beginning-start 是时点 id，不是事件类名）：实测 registerTrigger 抛 TriggerSpecValidationError，" +
    "能力无法订阅此时点。空 filter 虽然合法，但实测 matchesTriggerEvent({}, beginning-start/player B, controller A) 为 true，" +
    "会把对手的 Beginning Phase 一并订阅，丢掉 \"your\" 的限定。" +
    "(2) 触发条件没有相对玩家归一化：实测参考内核 test() 把符号 self/opponent 当字面值比较（条件恒 false，383.2.a.1/133.5.a.1/431.1），" +
    "绑定成绝对玩家 id 后才成立；condition 经 PipelineHost.testTrigger → 内核 test() 求值，chain/engine.ts 只包装 query 的 controller/owner。" +
    "(3) 多人对局还需 exists 对手量化，不能把所有对手的符文总数当作某一对手的数量。" +
    "(4) beginning-start 时点本身有发射方，但第 (1) 条使能力无法订阅它。" +
    "continuous.might、effect 本体与单次触发的比较原语已有执行证据。不近似实现。",
  abilities,
  sourceText:
    "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
    "+1 :rb_might: this turn."
} satisfies CardProgram;
