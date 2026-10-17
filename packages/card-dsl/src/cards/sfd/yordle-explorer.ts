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
 *   形状，events/pipeline-match.ts 逐键比较）。
 * - "draw 1"：effect.draw（414.1/414.3），抽牌者缺省为能力控制者。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——费用载荷与事件适配仍有缺口：
 * - card-played 时点、player 绑定、EventPattern.details 的 matcher、以及 effect.draw 本体都有
 *   真实执行证据。当前生产适配器在翻译带 details 的 EventPattern 时仍把 details 送入
 *   ObjectFilter，报 Unsupported filter field details，不能把该触发注册进生产链。
 * - 即使适配器保留 details，card-played 的生产发射（chain/engine.ts）也没有派生并携带被打出
 *   牌的印刷（或复制）Power cost；details: { printedPowerCostAtLeast: 2 } 必须在真实载荷中
 *   保持 fail-closed，不能放宽成「任意打出」（206.1/383.2.a.1）。
 * 依赖：生产触发适配器正确转发 EventPattern.details，以及 card-played 事件的印刷/复制
 * Power cost 载荷生产者（206/206.1、383.2.a.1）。不近似实现。
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
    "触发时点、player: self 绑定、EventPattern.details matcher 与 effect.draw 本体均已由 golden 真实执行，" +
    "但当前生产适配器翻译带 details 的 EventPattern 时仍把 details 送入 ObjectFilter，报 Unsupported filter field details，" +
    "因此该触发尚不能注册进生产链；即使适配器修正，card-played 的生产发射（chain/engine.ts）也只带对象与玩家，" +
    "没有派生被打出牌的印刷/复制 Power cost，details: { printedPowerCostAtLeast: 2 } 仍会在真实发射中 fail-closed。" +
    "不能用恒真条件或任意 card-played 近似 206.1/383.2.a.1。依赖：EventPattern.details 的生产适配与 card-played 印刷/复制" +
    "Power cost 载荷生产者。",
  abilities,
  sourceText: "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
} satisfies CardProgram;

export default program;
