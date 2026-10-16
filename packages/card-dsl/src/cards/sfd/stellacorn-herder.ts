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
 * - object-moved 触发缺「移动的是本卡」的可判定载荷：events/action-adapter.ts 为
 *   move-location 派生的事件带 object/fromZone/toZone（区域），但不带 Location
 *   起终点（timing-points.ts 声明的 payloadFields），且 events/pipeline-match.ts 只读
 *   EventPattern 的 object/source/target/player/fromZone/toZone/amount/details，不读取
 *   卡程序里的内层 filter 锚点（filter: { source: "self" }），因此触发会命中任意移动。
 *   458/458.1 的 Recall 排除同样依赖该载荷。
 * - 进一步，没有已合入消费方把 CardProgram 的 triggered 能力注册成事件订阅
 *   （CardProgram → TriggerRegistration，RIFT-120）。
 * 依赖：RIFT-120（move-location 事件载荷与卡牌触发注册）。不近似实现（不把任意移动
 * 当作本卡移动，也不用直接改区域代替 effect.draw）。
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
    "object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 派生的事件只带 object/fromZone/toZone（区域），" +
    "不填 449.1/449.2 要求的 Location 起终点（timing-points.ts 声明的 payloadFields），且 events/pipeline-match.ts 只读 " +
    "EventPattern 的 object/source/target/player/fromZone/toZone/amount/details，不读取卡程序里的内层锚点 filter: { source: \"self\" }，" +
    "因此该触发会命中任意对象的移动，无法表达「是本卡在移动」，458/458.1 的 Recall 排除同样缺该载荷；" +
    "此外没有已合入消费方把 CardProgram 的 triggered 能力注册成事件订阅（RIFT-120）。" +
    "effect.draw（414.1/414.3）本体已合入，golden 用解释器 + 参考内核真实执行该 body。" +
    "依赖：RIFT-120（move-location 事件载荷与卡牌触发注册）。不近似实现。",
  abilities,
  sourceText: "When I move, draw 1."
} satisfies CardProgram;

export default program;
