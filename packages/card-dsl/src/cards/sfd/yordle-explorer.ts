import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yordle Explorer (sfd-100-221) — Unit, 4 energy, 无印刷 Power, Might 4，
 * 领域 Body，标签 Yordle / Bandle City。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-100-221，逐字）：
 *   "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.4.a："When you play a card …" 是触发能力（383.4.a.4：另一张牌被打出时
 *   触发，不属 Play Effect）；时点用 "card-played"（events/timing-points.ts；
 *   chain/engine.ts 在 spell/unit/gear 结算完成时发射）。"you" 指能力控制者（190.6.d），
 *   故 filter 的 player 用 "self"（events/pipeline-match.ts 的 playerMatches 把 self 与
 *   能力控制者比较）。
 * - "with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more"：135.2.e.5 /
 *   135.2.e.5.a 说明 :rb_rune_rainbow: 是任意域 Power，因此这是「被派出牌的印刷 Power
 *   cost ≥ 2」这一事件条件的简称；206.1 规定需要判定卡牌费用时读取印刷（或复制）费用。
 *   383.2.a.1 要求把该从句作为触发条件求值，因此它写在 EventPattern.details 载荷键上
 *   （events/trigger-spec.ts 的 EventPattern.details 是「按事件载荷字段匹配」的既有封闭
 *   形状，events/pipeline-match.ts 逐键比较）。同一 EventPattern 上的 object: {} 是事件
 *   模式锚点：programs/filters.ts 的 translateTriggerFilter 只在 object/source/target 之一被
 *   显式给出时才走事件模式，否则会把 details 收进 ObjectFilter 并报 Unsupported filter
 *   field details。details 在真实载荷出现前保持 fail-closed（缺字段即不匹配），不会被放宽
 *   成「任意打出」（206.1/383.2.a.1）。
 * - "draw 1"：effect.draw（414.1/414.3），抽牌者缺省为能力控制者。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——事件条件的费用载荷仍未接通：
 * - 已合入且由 golden 真实执行：card-played 时点、player 绑定、EventPattern.details 的生产
 *   翻译（programs/filters.ts 原样转发 details）、matchesTriggerEvent 的逐键载荷匹配、以及
 *   effect.draw 本体。
 * - 仍缺：card-played 的生产发射（chain/engine.ts 的 resolve）只带 object/player，没有派生
 *   被打出牌的印刷（或复制）Power cost 载荷，因此 details: { printedPowerCostAtLeast: 2 }
 *   在真实发射中 fail-closed。需要的是事件载荷生产者（按 206/206.1 读取印刷/复制费用），
 *   而适配器转发已随 RIFT-257 合入。
 * 依赖：card-played 事件的印刷/复制 Power cost 载荷生产者（206/206.1、383.2.a.1）。
 * 不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // 190.6.d："you" 是能力控制者。
        player: "self",
        // 事件模式锚点：translateTriggerFilter 需要 object/source/target 之一才会保留
        // details；空对象不增加任何对象限制（被打出的牌可以是任意卡）。
        object: {},
        // 383.2.a.1 的附加条件从句：206.1 要求读印刷（或复制）费用，
        // 135.2.e.5 的 :rb_rune_rainbow: 表示任意域 Power，故阈值为 ≥2。
        // 该键属于 EventPattern 的封闭载荷形状，但今天的 card-played
        // 发射不携带它（见 judgeReason），因此匹配 fail-closed。
        details: { printedPowerCostAtLeast: 2 }
      }
    },
    optional: false,
    body: [
      {
        id: "yordle-explorer.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0bf2f78a39c15787c743ca80bf9a8a0faa2ab20b9e055830b9d7e280dd5469ed",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "触发时点、player: self 绑定、EventPattern.details 的生产翻译与 matcher、以及 effect.draw 本体均已合入，" +
    "并由 golden 真实执行（programs/filters.ts 的 translateTriggerFilter 原样转发 details，" +
    "events/pipeline-match.ts 逐键比较载荷）。仍缺 card-played 事件的印刷/复制 Power cost 载荷：" +
    "chain/engine.ts 的 resolve 发射只带 object/player，没有按 206/206.1 派生被打出牌的印刷（或复制）Power cost，" +
    "details: { printedPowerCostAtLeast: 2 } 在真实发射中因此 fail-closed。" +
    "不能用恒真条件或任意 card-played 近似 206.1/383.2.a.1。" +
    "依赖：card-played 事件的印刷/复制 Power cost 载荷生产者（206/206.1、383.2.a.1）。",
  abilities,
  sourceText: "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
} satisfies CardProgram;

export default program;
