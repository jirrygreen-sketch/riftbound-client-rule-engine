import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Portable Portal (rad-087-167) — Unit, 2 energy, Might 无印刷值（null）, Body,
 * 标签 Device。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here,
 *   kill this.)
 *   When you play this, you may pay :rb_rune_body: to ready a unit here.
 *   Friendly units here have [Ganking]. (They can move from battlefield to
 *   battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - [Deploy] 是 830 的关键词（830.1.b：可被打到任意战场、只能打到战场、对手在此固守时消灭），
 *   以 keyword 能力声明；展开（合法打出位置改写 + hold 触发消灭）由已合入的
 *   keywords/Deploy.ts 提供，再由绑定/消费管线接线。
 * - "When you play this, you may pay :rb_rune_body: to ready a unit here"：383.3.a 的
 *   "you may" → 契约 3.9 的 choice.optional（把被选指令包进 body）；"pay :rb_rune_body:"
 *   是 357 的 Power 费用，"ready a unit here" 用已合入的 effect.ready 原语 + 位置限制的
 *   TargetSpec（"here" = 来源所在位置，用 sameLocationAs: self）。"a unit" 不限控制者。
 * - "Friendly units here have [Ganking]"：810 的静态授予（continuous.grant-keyword，
 *   RIFT-258；Ganking 本身的展开由 RIFT-83/86 的 Ganking.ts 提供）。
 * - "you may pay :rb_rune_body:"：357 的 Power 费用；效果内支付属 [do X] to [do Y]
 *   的指令内费用（355.10.c.1），cost.pay 原语已合入，但缺 203.3 的
 *   success-gated payment body（cost/kinds/README.md 契约变更请求 #2）。
 *
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deploy" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "portable-portal.may",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay :rb_rune_body: to ready a unit here?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "portable-portal.pay-body",
                op: "cost.pay",
                args: {
                  payments: { kind: "constant", value: { energy: 0, power: ["Body"] } }
                }
              },
              {
                id: "portable-portal.ready",
                op: "effect.ready",
                linkedTo: "portable-portal.pay-body",
                args: {
                  objects: { kind: "constant", value: { kind: "target", id: "portable-portal.unit-here" } },
                  amount: { kind: "constant", value: 1 }
                },
                targets: [
                  {
                    id: "portable-portal.unit-here",
                    filter: { type: "unit", zone: "board", sameLocationAs: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Ganking",
      filter: {
        type: "unit",
        controller: "controller",
        zone: "board",
        sameLocationAs: "self"
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-c23ae2a28f5e64f8b56146faf62b3012c3c1902a3ebdd597858ac9d76f814fdc",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Deploy]（CR 830.1.b）的 KeywordDef 与 continuous.location 原语已合入，但 programs/statics.ts 仍报 continuous.location has no layer mapping；展开的 hold/here:true 也不能通过触发过滤与事件词表。" +
    "「you may pay Body to ready a unit here」已接 cost.pay；支付请求、拒绝选择和支付失败事务回滚均有执行证据，但参考 TestWorld 的 pay 动作尚不扣减 Power，不能作为资源已实际消费的证据。仍缺 success-gated payment body/savepoint（355.10.c.1、203.3）以在不能支付时跳过该指令而继续结算，linkedTo 本身不提供支付门控；嵌套目标另被 chain Finalize 的 target-selection lifecycle gate 阻止。" +
    "「a unit here」已保留任意控制者的单位选择，但 sameLocationAs 仍被 programs/filters.ts 拒绝；TargetSpec.location 虽在类型/解释器支持 source-location，当前 IR 校验器却按 LocationFilter 拒绝该拼写（invalid-location-kind），需契约/校验对齐。" +
    "友方 Ganking 静态的 sameLocationAs 已能绑定，但 layers/filter.ts 的 matchesObjectFilter 未按值比较结构化 LocationRef，同地点的独立快照仍不能匹配。只保留局部 ready/grant 执行证据，不宣称整卡可执行。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
