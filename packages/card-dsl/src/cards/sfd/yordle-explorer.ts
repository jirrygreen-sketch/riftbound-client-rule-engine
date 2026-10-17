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
 * status 判定（cards/README.md 第 2 节）：judge-required——费用载荷尚不存在：
 * - 触发时点、player 绑定与 effect.draw 本体的可执行证据都在 golden 里；缺的是
 *   PipelineEvent 的载荷：card-played 的发射（chain/engine.ts）只带被打出的对象与玩家，
 *   TimingEmission/PipelineEvent 没有印刷（或复制）费用的字段，因此
 *   details: { printedPowerCostAtLeast: 2 } 在今天的生产发射里永远匹配不到
 *   （fail-closed，不会误触发任意抽牌）。这不是可近似的东西：把条件放宽成
 *   「任意打出」会直接违反 206.1/383.2.a.1，故不实现。
 * - 之前的 powerCostGte 嵌套描述性键已删除：programs/filters.ts 的
 *   translateObjectFilter 只接受封闭的对象过滤键，该键会在 CardProgram →
 *   TriggerRegistration 的绑定期被 judge-required 拒绝；Condition 的 Expr 也没有
 *   「事件对象的印刷费用」读数（object-property 只读 self/source/target/pick/linked，
 *   而刚被打出的牌不是本能力的这些锚点）。
 * - 绑定侧还差一步：卡牌程序适配层（programs/filters.ts 的 translateTriggerFilter）
 *   目前把顶层 details 当作 Unsupported filter field 拒绝，不会把它转发进
 *   TriggerRegistration 的 EventPattern；该转发属仍在进行的 RIFT-257。
 * 依赖：card-played 事件的印刷费用载荷与 details 谓词消费（206/206.1 的 cost 谓词，
 * RIFT-120 后续/协调任务），以及卡牌程序 → 触发注册的生产接线（RIFT-257）。
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
    "触发条件「with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more」无法判定：383.2.a.1 要求该从句在触发时求值，" +
    "206.1/135.2.e.5 规定阈值为被派出牌的印刷（或复制）Power cost ≥ 2；它已按 EventPattern.details 的封闭载荷形状写在 " +
    "details: { printedPowerCostAtLeast: 2 }，但 card-played 的生产发射（chain/engine.ts）只带对象与玩家，" +
    "TimingEmission/PipelineEvent 没有印刷费用字段，故该键永远匹配不到（fail-closed）。" +
    "冻结 Condition 的 Expr 也没有「事件对象印刷费用」读数（object-property 只读 self/source/target/pick/linked，" +
    "刚被打出的牌不是本能力的这些锚点），CountExpr 的 filter 同样不接受费用谓词；" +
    "旧的嵌套 powerCostGte 描述性键已删除——programs/filters.ts 的 translateObjectFilter 不接受该键，" +
    "会在 CardProgram → TriggerRegistration 绑定期被 judge-required 拒绝。绑定侧还差一步：" +
    "translateTriggerFilter 目前把顶层 details 当作 Unsupported filter field 拒绝，" +
    "不会把它转发进 TriggerRegistration 的 EventPattern（RIFT-257 进行中）。" +
    "触发时点（card-played）、player: self 绑定与 effect.draw 本体都已合入并由 golden 真实执行；" +
    "但不把条件近似成恒真（那会违反 206.1/383.2.a.1）。" +
    "依赖：card-played 的印刷费用载荷与 details 谓词（RIFT-120 后续/协调任务）与卡牌程序 → 触发注册的生产接线（RIFT-257）。",
  abilities,
  sourceText: "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
} satisfies CardProgram;

export default program;
