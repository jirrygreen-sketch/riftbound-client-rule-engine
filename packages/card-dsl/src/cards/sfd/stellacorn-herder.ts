import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Stellacorn Herder (sfd-048-221) — Unit, Calm, Mount Targon.
 * energy 4, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-048-221，逐字）:
 *   "When I move, draw 1."
 *
 * 规则依据（CR v1.5）:
 * - "When I move"（421.1、449.1/449.2、458/458.1）：Move 是永久物在两个 Location
 *   之间的移动；封闭时点 object-moved 表示一次成功的 Move，Recall 不是 Move、不触发
 *   移动类能力。触发 filter 用 source: "self" 指称本卡（已合入 ogn/traveling-merchant
 *   同一印文形状）。
 * - "draw 1"：414.1/414.3——缺省抽牌者是能力控制者（190.6.d），只提交封闭的 draw
 *   GameAction，牌库顺序与 Burn Out 由内核负责（已合入 effect.draw）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 卡牌程序绑定（RIFT-257）已合入，events/pipeline 的注册路径会调用
 *   translateTriggerFilter 把内层锚点 filter: { source: "self" } 解析为 objectId
 *   锚点；但 EventPattern 词表（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）
 *   没有 object-moved，pipeline.registerTrigger → assertTriggerSpec 以
 *   invalid-event-type 拒绝该 filter，触发器无法注册。
 * - events/action-adapter.ts 为 move-location 派生的事件只带 object/fromZone/toZone
 *   （区域均为 "board"），没有 timing-points.ts 为 449.1/449.2/458 声明的 Location
 *   起终点载荷（fromKind/fromLocationId/toKind/toLocationId），无法区分 Move 与
 *   Recall。
 * 依赖：RIFT-39（object-moved 进入 EventPattern 词表；移动载荷缺口由本卡说明记录）。
 * effect.draw（414.1/414.3）本体已合入并由 golden 真实执行；不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "stellacorn-herder.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-00a882b72ff4d8c644400fb6de458749cbdda6c6b7141ca71544931161253781",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "卡牌程序绑定（RIFT-257）已合入，translateTriggerFilter 能把内层锚点 " +
    "filter: { source: \"self\" } 解析为 objectId 锚点；但 EventPattern 词表（events/trigger-spec.ts 的 " +
    "EVENT_PATTERN_TYPES）没有 object-moved，注册时会被 assertTriggerSpec 以 invalid-event-type 拒绝，触发器无法进入唯一事件管线。" +
    "其次，events/action-adapter.ts 为 move-location 派生的事件只带 object/fromZone/toZone（区域均为 \"board\"），" +
    "没有 timing-points.ts 为 449.1/449.2/458 声明的 Location 起终点载荷（fromKind/fromLocationId/toKind/toLocationId），" +
    "无法区分 Move 与 Recall。effect.draw（414.1/414.3）本体已合入，golden 用解释器 + 参考内核真实执行该 body。" +
    "依赖：RIFT-39（object-moved 进入 EventPattern 词表）。移动载荷（Location 起终点）与 Move/Recall 区分是第二个独立缺口，属契约级。不近似实现。",
  abilities,
  sourceText: "When I move, draw 1."
} satisfies CardProgram;

export default program;
