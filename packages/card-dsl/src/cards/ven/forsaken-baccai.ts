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
 * status = judge-required（复核 2026-10-17）：
 * 1. 触发注册仍被封闭词汇挡住：卡牌声明 { event: \"beginning-start\", player: \"self\" }，但
 *    events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 只列事件类名，beginning-start 是时点 id；
 *    实测把该 spec 交给 EventPipeline.registerTrigger 抛 TriggerSpecValidationError
 *    （trigger.filter.event 非法），programs/triggers.ts 的注册因此在生命周期挂载时失败关闭。
 * 2. 触发条件没有相对玩家归一化：chain/engine.ts 只包装 ResolveContext.query 的 controller/owner，
 *    而触发条件经 PipelineHost.testTrigger → 内核 test() 求值；实测符号 self/opponent
 *    被当作字面值比较（条件为 false），绑定成绝对玩家 id 后才为 true。
 * 3. 多人对局还缺“存在一个符文更多的对手”的 exists 量化。测试中将 self/opponent 绑定到 A/B
 *    只证明数量比较原语。continuous.might 与单次触发本体已有执行证据。
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
    "卡牌声明的 { event: \"beginning-start\", player: \"self\" } 不在 events/trigger-spec.ts 的 EVENT_PATTERN_TYPES " +
    "封闭词汇里（beginning-start 是时点 id，不是事件类名）：实测 EventPipeline.registerTrigger 抛 " +
    "TriggerSpecValidationError，programs/triggers.ts 的触发注册因此失败关闭，能力无法订阅此时点。" +
    "触发条件也没有相对玩家归一化：chain/engine.ts 只包装 query 的 controller/owner，而条件经 " +
    "PipelineHost.testTrigger → 内核 test() 求值；实测符号 self/opponent 被当字面值比较（383.2.a.1/133.5.a.1/431.1），" +
    "绑定成绝对玩家 id 后才成立。多人对局还需 exists 对手量化，不能把所有对手的符文总数当作某一对手的数量。",
  abilities,
  sourceText:
    "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
    "+1 :rb_might: this turn."
} satisfies CardProgram;
