import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shen, Scourge of Shadows (ven-042-166) — Unit, Calm, 5 Energy + 1 Calm Power,
 * Might 6, tag Shen/Ionia/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-042-166，逐字）：
 *   When I hold, if there is exactly one other unit you control here, draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.a："When I hold" 是 Hold Effect；单位类 Hold Effect
 *   在该单位于 Beginning 的计分步骤中位于被固守的战场时进入链。封闭时点是
 *   events/timing-points.ts 的 "hold"（ruleRefs 315.2.b.2 / 471.2 / 473.2.b）；
 *   471.2 的 Hold 定义是“回合玩家的 Beginning Phase 中维持对一个本回合尚未计分的战场的控制”。
 * - 383.2.a / 383.2.a.1：紧跟触发条件之后的 "if there is exactly one other unit you control
 *   here" 属于 Trigger Condition，不是 Effect（规则原文的 Sona, Harmonious 例即此形状），
 *   因此写在 trigger.condition 上。
 * - 143.1 / 143.1.b："other unit you control here" = 与本体同地点（053.3 的 here）、
 *   由能力控制者控制、且不是本体自身（exclude）的单位，恰好 1 个；count 表达式计数，
 *   锚点用契约 3.6 的 sameLocationAs / exclude / controller。
 * - 414.1 / 414.3 / 190.6.d："draw 1" 是 effect.draw 的印刷常量 1；隐含的 "you" 是能力
 *   控制者（effect.draw 省略 player / target / pick 时取 ctx.controller）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. Hold Effect 的触发没有可执行路径：events/timing-points.ts 里有 "hold" 时点，
 *    events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 也有 "held"（EVENT_NAMES 把它映射到
 *    该时点），但 scoring/ 还没有接入 chain/events 单管线（RIFT-120），没有生产者 emit
 *    hold，也没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration；
 *    events/pipeline-match.ts 也不消费内层 filter 锚点（它只读 EventPattern 的
 *    object/source/target/player/fromZone/toZone/amount/details），因此 "I hold" 的同一性
 *    没有消费方；
 * 2. "here" 的判定依赖 808.1.d.3 式的位置信息与 sameLocationAs 锚点：事件匹配器不识别该锚点，
 *    条件里的 "here" 只能作为有依据的 IR 形状保留（同 ven-063-166 Nasus, Guardian of Knowledge
 *    与 sfd/corinna-veraza 记录的同一缺口）。
 * 依赖：RIFT-120（scoring → chain/events 的 hold 发射与卡牌触发注册）。条件里的 unit 计数、
 * sameLocationAs / exclude 锚点与 body 的 effect.draw 都已合入，golden 用真实解释器执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      // 383.4.d.2.a：单位类 Hold Effect 由“我在此固守”标识；"held" 是封闭枚举
      // EVENT_PATTERN_TYPES 中对应 "hold" 时点的值（EVENT_NAMES 的映射），内层
      // source: "self" 是 383.4.d.2.a 所指的同一性锚点（消费方缺失，见 judgeReason）。
      filter: { event: "held", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的两个子句都属于 Trigger Condition。
      condition: {
        kind: "all",
        conditions: [
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "other-friendly-units-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "controller",
                // 053.3 的 "here"：与本体同一地点（契约 3.6 的 sameLocationAs 锚点）。
                sameLocationAs: "self",
                // "other"：排除本体自身（355.9.b 的排除限制同用 exclude）。
                exclude: "self"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 1 }
          }
        ]
      }
    },
    optional: false,
    body: [
      {
        id: "shen-scourge-of-shadows.draw-one",
        op: "effect.draw",
        // 414.3：印刷常量 1；抽牌者缺省为能力控制者（190.6.d）。
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-bc2ea9de6b5b9ec4e65b44cd9a1410db1ee6b06013dbd81fb1d1b5daa675f1af",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) Hold Effect（383.4.d / 383.4.d.1 / 383.4.d.2.a）的触发没有可执行路径：events/timing-points.ts 定义了 \"hold\" 时点" +
    "（315.2.b.2 / 471.2 / 473.2.b），events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 也有 \"held\"（EVENT_NAMES 将其映射到该时点），" +
    "但 scoring/ 未接入 chain/events 单管线（RIFT-120），没有生产者 emit hold，也没有已合入订阅方把 CardProgram 的 triggered ability" +
    " 注册成 TriggerRegistration；events/pipeline-match.ts 也不消费内层 filter 锚点（只读 EventPattern 的 object/source/target/player/" +
    "fromZone/toZone/amount/details），因此「I hold」的同一性没有消费方；" +
    "(2)「if there is exactly one other unit you control here」是 383.2.a.1 的触发条件（非效果条件，规则原文的 Sona 例即此形状），" +
    "其中 \"here\" 的判定依赖位置信息与契约 3.6 的 sameLocationAs 锚点，而事件/条件匹配器不识别该锚点，只能按有依据的 IR 形状保留" +
    "（同 ven-063-166、sfd/corinna-veraza 记录的同一缺口）。依赖 RIFT-120（scoring → chain/events 的 hold 发射与卡牌触发注册）。" +
    "条件里的 unit 计数与 sameLocationAs/exclude 锚点、body 的 effect.draw（414.1/414.3）均已合入，golden 用真实解释器执行。",
  abilities,
  sourceText: "When I hold, if there is exactly one other unit you control here, draw 1."
} satisfies CardProgram;
