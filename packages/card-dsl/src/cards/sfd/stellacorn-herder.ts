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
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-17 复核）。
 * - 卡牌程序绑定已合入：events/pipeline 的注册路径调用 translateTriggerFilter，把内层锚点
 *   filter: { source: "self" } 解析为 object: { objectId: <本卡> }；但 EventPattern 词表
 *   （events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）仍然没有 object-moved，
 *   pipeline.registerTrigger → assertTriggerSpec 以 invalid-event-type 拒绝该 filter，
 *   触发器进不了事件管线（RIFT-39 只补齐了 timing-points.ts 的时点表，未扩展该词表）。
 * - events/action-adapter.ts 为 move-location 派生的 object-moved 事件只带被移动的 object
 *   （加 player/source 等通用字段），既不携带 timing-points.ts 为 421.1/449.1/449.2/458
 *   声明的 Location 起终点载荷（fromKind/fromLocationId/toKind/toLocationId，即该时点的
 *   payloadFields），也不带 fromZone/toZone——起止地点只出现在 turn/flow.ts 为同一次移动
 *   另外发出的 object-leaves-、object-enters- 系列事件上（本层不派生它们）。因此过滤器
 *   读不到 Move 的起点与终点，也无法区分
 *   Move 与 Recall（458.1：Recall 不触发 Move 类触发）。
 * - effect.draw（414.1/414.3）本体已合入并由 golden 真实执行；不近似实现。
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
    "卡牌程序绑定已合入：translateTriggerFilter 能把内层锚点 filter: { source: \"self\" } 解析为 object 锚点，" +
    "但 EventPattern 词表（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）仍没有 object-moved，注册时被 assertTriggerSpec " +
    "以 invalid-event-type 拒绝（实测 code=invalid-event-type），触发器无法进入唯一事件管线；timing-points.ts 里虽有该时点，" +
    "词表与注册校验尚未接通。其次，events/action-adapter.ts 为 move-location 派生的 object-moved 事件只带被移动的 object" +
    "（加 player/source 等通用字段），没有 timing-points.ts 为 421.1/449.1/449.2/458 声明的 Location 起终点载荷" +
    "（fromKind/fromLocationId/toKind/toLocationId），也不带 fromZone/toZone——起止区域只出现在同一提交附带的 " +
    "turn/flow.ts 为同一次移动另外发出的 object-leaves-*/object-enters-* 事件上；过滤器因此读不到 " +
    "Move 的起点与终点，也无法区分 Move 与 Recall。" +
    "effect.draw（414.1/414.3）本体已合入，" +
    "golden 用解释器 + 参考内核真实执行该 body。依赖：RIFT-120 后续（EventPattern 词表补 object-moved）与移动事件载荷" +
    "（Location 起终点）；两处都未合入，不近似实现。",
  abilities,
  sourceText: "When I move, draw 1."
} satisfies CardProgram;

export default program;
