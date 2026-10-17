import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Harpoon Squad (sfd-137-221) — Unit, Chaos, Pirate/Bilgewater.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-137-221，逐字）:
 *   "When I move from a battlefield, give me +2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - "When I move"（383.1；421.1、449.1/449.2；458/458.1 的 Recall 不是 Move）：封闭时点
 *   object-moved 表示一次成功的 Move（"When I move" 用 filter 内层锚点 source: "self"
 *   指称本卡，与已合入 ogn/noxian-drummer、sfd/corinna-veraza、sfd/apprentice-smith 同型）；
 *   "from a battlefield" 是该次移动的起点性质，按 EventPattern 的 fromZone 写成
 *   fromZone: "battlefield"（timing-points.ts 为 object-moved 声明 fromKind/fromLocationId 等
 *   payloadFields，Section 3.5 的时点载荷形状）。
 * - "give me +2 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might；143.2.a 的有效 Might、317.2.c "3d. All 'this turn' effects expire
 *   simultaneously"）。它不是 Buff 计数器：702–704 的 Buff 是计数物，effect.buff 文件头也
 *   明确 "give me +2 [M] this turn" 归 continuous.might。"me" 是能力宿主，用 continuous.might
 *   的 appliesTo: "self" 简写（已合入 ogn/stand-united 之后的同一形状），不写运行时 ObjectRef。
 *
 * status 判定（cards/README.md 第 2 节，复核 2026-10-17）：judge-required。
 * - 效果体已可执行：continuous.might 指令已合入（RIFT-258），"me" 经 appliesTo: "self"
 *   解析为能力宿主，结算时经 ResolveContext.addContinuous 注册 arithmetic 图层效果、
 *   duration "this-turn" 映射为回合结束到期；golden 经 chain/interpreter-adapter.ts 的生产
 *   适配器执行并断言真实有效 Might 与到期。
 * - 触发不可绑定：object-moved 已有时点定义（timing-points.ts，triggerable）与 producers
 *   （events/action-adapter.ts 的 ACTION_TIMINGS 把 move-location 映射到 object-moved），
 *   但封闭的 EVENT_PATTERN_TYPES 词表不含 object-moved（events/trigger-spec.ts），
 *   assertTriggerSpec 以 invalid-event-type 拒绝带 event 的 EventPattern。
 *   programs/filters.ts 的 translateTriggerFilter 仍会把本卡 filter 翻成
 *   { event: "object-moved", object: { objectId }, fromZone: "battlefield" }，
 *   该形状没有可注册的路径。
 * - 更不能退化成纯 ObjectFilter：ObjectFilter 没有 fromLocation/fromZone 字段
 *   （events/trigger-spec.ts 的 ObjectFilter 只按当前特征匹配），{ objectId } 会同时命中
 *   从 Base 出发的移动，把"从战场移动"扩成任意移动；"from a battlefield" 是这次移动的
 *   起点性质（449.1/449.2），必须由 EventPattern 的 fromZone 载荷承载。
 * 依赖：事件词表扩展（object-moved 进入 EventPattern 或等价来源位置选择器）。
 * 不近似实现：不用 Buff 计数器冒充临时 Might，也不把任何移动都当作"从战场移动"，
 * 更不把触发删掉只留效果体。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        // 449.1/449.2：起点是战场；458/458.1 的 Recall 不触发移动类能力。
        fromZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        // "give me +2 [M] this turn" — arithmetic 图层的临时 Might 修改（143.2.a、317.2.c）。
        id: "harpoon-squad.give-plus-2",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // "me" 是能力宿主：continuous.might 的 appliesTo: "self" 简写
          // （契约 3.6 的符号选择器），不是构造出来的 TargetSpec。
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f696312134479041b97777c95666ee948dd620df1b82a432d5d877753660bfd2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "效果体已可执行：continuous.might 指令已合入，\"give me +2 :rb_might: this turn\" 经 " +
    "appliesTo: \"self\" 解析为能力宿主，结算时经 ResolveContext.addContinuous 注册 arithmetic 图层效果、" +
    "duration \"this-turn\" 映射为回合结束到期（317.1.a/468.7.c）；golden 经 chain/interpreter-adapter.ts " +
    "的生产适配器执行并断言真实有效 Might 与到期。" +
    "整卡仍不可执行：object-moved 已有时点定义（timing-points.ts，triggerable）且 events/action-adapter.ts 已把 " +
    "move-location 映射到该时点，但封闭的 EVENT_PATTERN_TYPES 词表不含 object-moved（events/trigger-spec.ts），" +
    "assertTriggerSpec 以 invalid-event-type 拒绝带 event 的 EventPattern；programs/filters.ts 的 translateTriggerFilter " +
    "把本卡 filter 翻成 { event: \"object-moved\", object: { objectId }, fromZone: \"battlefield\" } 后没有可注册路径。" +
    "也不能退化成纯 ObjectFilter：ObjectFilter 没有 fromZone/fromLocation 字段，{ objectId } 会同时命中从 Base 出发的移动，" +
    "把「从战场移动」（449.1/449.2）扩成任意移动。" +
    "依赖：事件词表扩展（object-moved 进入 EventPattern 或等价来源位置选择器）。" +
    "不近似实现（不用 Buff 计数器冒充临时 Might，也不把任何移动都当作「从战场移动」）。",
  abilities,
  sourceText: "When I move from a battlefield, give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
