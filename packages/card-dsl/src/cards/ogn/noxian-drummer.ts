import type { CardProgram } from "../../ir/index.js";

/**
 * Noxian Drummer (ogn-222-298) — Unit, 3 energy, Might 3（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-222-298）：
 *   When I move to a battlefield, play a 1 :rb_might: Recruit unit token here.
 *   (It is also at the battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 421/449：Move 是对象在两个 Location 之间的移动；449.1/449.2 用起点与终点定义一次移动；
 *   458/458.1 Recall 不是 Move，不触发移动类触发。
 * - 封闭时点 object-moved（events/timing-points.ts，refs 421.1/449.1/449.2/458）用于“成功完成 Move”。
 * - 「play a … token here」：440.2.c/185.2.a/350.2/354（链上生成后打出）；Recruit 见 CR 187.1，
 *   effect.token 定义 id "recruit"。「here」= 来源当前位置（359.3.f.1/f.2）。
 *
 * 结构：object-moved 触发（filter 用 toZone: "battlefield" 表达“移动到战场”）；body[0] 读来源位置，
 * body[1] 在该位置打出 1 个 Recruit token。
 *
 * status = judge-required（2026-10-17 复核）：触发注册先失败在事件名上——
 * events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举，没有 object-moved，
 * 而 translateTriggerFilter 会把卡片声明的 event 原样保留，validateTriggerSpec 实测拒绝；
 * pipeline-match.ts 的别名映射发生在其后。放行后仍缺对象载荷：action-adapter 的 object-moved
 * 发射只填 object/player/amount（实测无 toZone/toKind），而 turn/flow.ts 的
 * object-enters-battlefield 名称同样不在词表中，且实际 Standard Move 结果只以
 * requiresMoveTriggers 交给外层、没有提交进事件管线。见 judgeReason。
 */
const noxianDrummer = {
  canonicalCardId: "card.hash-5518503e78770284d5f2f55292d0d27dd571a336dd4bcae40fdc3ee530d2b12d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发注册仍失败，且不是停在事件名上：(1) events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 是封闭枚举，" +
    "没有 object-moved 名称，而 translateTriggerFilter 会把卡片声明的 event: \"object-moved\" 原样保留；" +
    "validateTriggerSpec 实测返回 trigger.filter.event/invalid-event-type，registerProgramTriggers 抛 TriggerSpecValidationError。" +
    "pipeline-match.ts 的别名映射发生在其后，救不了这次注册。" +
    "(2) 即使放行事件名，payload 也不足以判定“移动到战场”：" +
    "object-moved 的 action-adapter 发射只填 object/player/amount（实测一条 move-location 只产出 { timingPoint: \"object-moved\", object }），" +
    "toZone/toKind 从不填充，timing-points.ts 声明的 payloadFields 没有得到兑现，toZone: \"battlefield\" 永远不命中。" +
    "(3) 换成事件名直读 turn/flow.ts 的 object-enters-battlefield 也不行：该名称同样不在 EVENT_PATTERN_TYPES 中，" +
    "registerTrigger 实测拒绝；而且实际 Standard Move 结果本身也没有提交进事件管线——" +
    "zones/movement.ts 与 duel/standard-move-executor-v2.ts 只把 requiresMoveTriggers 交给外层，" +
    "没有已合入模块把该结果转成上述别名发射。" +
    "不近似实现（不用任何移动都触发代替）。" +
    "token 部分（effect.token mode play + condition.value 链接位置）已可用并有 golden 执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", objectId: "self", toZone: "battlefield" }
      },
      optional: false,
      body: [
        {
          id: "noxian-drummer.read-here",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "noxian-drummer.play-recruit",
          op: "effect.token",
          linkedTo: "noxian-drummer.read-here",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "noxian-drummer.read-here",
              key: "here"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I move to a battlefield, play a 1 :rb_might: Recruit unit token here. " +
    "(It is also at the battlefield.)"
} satisfies CardProgram;

export default noxianDrummer;
