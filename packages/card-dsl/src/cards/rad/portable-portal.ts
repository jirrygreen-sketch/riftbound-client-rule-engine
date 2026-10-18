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
 * 2026-10-18 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
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
    "[Deploy]（CR 830.1.b）的 KeywordDef 与 continuous.location 原语已合入，但 programs/statics.ts 的 layerFor 仍拒绝 continuous.location（no layer mapping）；hold 展开中的 here:true 也被 translateTriggerFilter 拒绝，" +
    "因此战场打出许可与「对手在此固守时消灭」仍没有进入生产链。" +
    "「you may pay Body to ready a unit here」已接 cost.pay；支付请求、拒绝选择与支付失败回滚都有真实执行证据，但 ReferenceTestKernel 的 pay action 仍不扣减 Power，不能据此证明资源已消费。" +
    "同时缺少 355.10.c.1 / 203.3 所需的 success-gated payment body/savepoint：支付失败必须跳过后续 ready 并继续结算，linkedTo 只传播成功结果，不能提供该门控；Chain Finalize 也只收集顶层 TargetSpec，嵌套 optional body 的目标尚未进入 target-selection lifecycle。" +
    "「a unit here」保留任意控制者的单位选择，但 sameLocationAs 仍被 programs/filters.ts 拒绝；把它改写成 TargetSpec.location 的 source-location 形式又会被 card-dsl 校验器按 LocationFilter 判为 invalid-location-kind。" +
    "友方 Ganking 的 static grant 能注册并解析来源位置，但 layers/filter.ts 的 matchesObjectFilter 仍按 location.type 比较，不能按值匹配结构化 LocationRef；只保留 ready、支付请求和局部 grant 的执行证据，不宣称整卡可执行。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
