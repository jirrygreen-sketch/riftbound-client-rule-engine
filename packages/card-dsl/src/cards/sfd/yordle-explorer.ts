import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yordle Explorer (sfd-100-221) — Unit, 4 energy, 无印刷 Power, Might 4，
 * 领域 Body，标签 Yordle / Bandle City。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-100-221，逐字）：
 *   "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.4.a.4："When you play a card …" 是触发能力（383.4.a.4：另一张牌被打出时
 *   触发，不属 Play Effect）；时点用 "card-played"（events/timing-points.ts；
 *   chain/engine.ts 在 spell/unit/gear 结算完成时发射）。"you" 指能力控制者（190.6.d），
 *   故 EventPattern.player 用 "self"（events/pipeline-match.ts 的 playerMatches 把 self 与
 *   能力控制者比较）。
 * - "with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more"：135.2.e.5 /
 *   135.2.e.5.a 说明 :rb_rune_rainbow: 是任意域 Power，两个即 2 Power；206.1 规定
 *   需要判定卡牌费用时读取印刷（或复制）的基础费用；383.2.a.1 要求把该从句作为触发条件
 *   求值，因此它写成 TriggerSpec.condition 的 event-printed 谓词（RIFT-359 合入的
 *   effects/interpreter/predicates/printed.ts + helpers.ts），由 events/pipeline.ts 在
 *   card-played 事件载荷上求值。131.3.b：卡牌的 Power cost 段可以不存在（deck-catalog
 *   用 power: null 表示），此时"2+ Power"应为假而不是缺信息。
 * - 事件载荷：chain/engine.ts 的 card-played 发射携带被打出牌的 ObjectSnapshot 与
 *   details.printed（energy/power/might），helpers.ts 的 readPrintedCharacteristic
 *   从事件对象/载荷读取印刷 Power。
 * - "draw 1"：effect.draw（414.1/414.3），抽牌者缺省为能力控制者。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 已合入并由 golden 真实执行：card-played 时点、player: self 绑定（190.6.d）、
 *   event-printed 印刷 Power 比较、以及 effect.draw 本体。golden 里印刷 2 Power 的牌
 *   触发放抽 1，印刷 1 Power 的牌不触发。
 * - 仍缺：被打出牌没有印刷 Power 段（deck-catalog power: null；131.3.b 该段可缺席）时，
 *   helpers.ts 的 numericPrinted 对 null 抛 MissingInformation
 *   （"Printed characteristic is unavailable"）；触发扫描因此把正在结算的牌留在 Chain 上
 *   并向调用方抛错，而不是按 206.1/131.3.b 把"无 Power cost"评价为使 2+ 条件为假。
 *   需要该谓词为缺失的印刷 Power 给出可比较语义（不得把卡牌数据的 null 改写成 0）。
 * 依赖：effects/interpreter/predicates/helpers.ts 的缺失印刷特征语义。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // 190.6.d："you" 是能力控制者。
        player: "self"
      },
      // 383.2.a.1 + 206.1：读被打出牌的印刷（或复制）Power cost，要求 >= 2。
      // 131.3.b 的"无 Power cost"必须求值为假；当前 helpers.ts 对 null 抛错
      // （见 judgeReason），故本卡保持 judge-required。
      condition: {
        kind: "event-printed",
        object: "object",
        characteristic: "power",
        operator: "gte",
        right: { kind: "constant", value: 2 }
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
    "383.2.a.1 要求把「with Power cost >= 2」作为触发条件求值；已合入并由 golden 真实执行的部分：card-played 发射携带被打出牌的印刷 Energy/Power/Might 快照" +
    "（chain/engine.ts 的 details.printed 与对象快照），effects/interpreter/predicates/ 的 event-printed 谓词" +
    "按 206.1 读取该印刷 Power 并比较，effect.draw 本体执行（golden：印刷 2 Power 的牌触发并抽 1，印刷 1 Power 的牌不触发）。" +
    "仍缺：被打出牌没有印刷 Power 段（deck-catalog power: null；131.3.b 该段可缺席）时，" +
    "effects/interpreter/predicates/helpers.ts 的 numericPrinted 对 null 抛 MissingInformation" +
    "（\"Printed characteristic is unavailable\"），触发扫描会把正在结算的牌留在 Chain 上并向调用方抛错，" +
    "而不是按 206.1/131.3.b 把「无 Power cost」评价为使 2+ 条件为假；" +
    "需要该谓词对缺失的印刷 Power 给出可比较语义（不得把卡牌数据的 null 改写成 0）。" +
    "依赖：effects/interpreter/predicates/helpers.ts 的缺失印刷特征语义。",
  abilities,
  sourceText: "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
} satisfies CardProgram;

export default program;
