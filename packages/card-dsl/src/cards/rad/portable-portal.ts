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
 *   TargetSpec（"here" = 来源所在位置，用 sameLocationAs: self）。本卡不禁用 "here" 的
 *   范围判定：目标过滤交给目标管线（RIFT-90）。
 * - "Friendly units here have [Ganking]"：810 的静态授予（continuous.grant-keyword，
 *   RIFT-258；Ganking 本身的展开由 RIFT-83/86 的 Ganking.ts 提供）。
 * - "you may pay :rb_rune_body:"：357 的 Power 费用；效果内支付属 [do X] to [do Y]
 *   的指令内费用（355.10.c.1），cost.pay 原语已合入，但缺 203.3 的
 *   success-gated payment body（cost/kinds/README.md 契约变更请求 #2）。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。当前缺口：
 * 1. Deploy 的 KeywordDef 已合入（RIFT-267），但 continuous.location 的结构化打出位置
 *    数据不被 playLocations 消费（只认名称型 no-battlefield/no-base 许可，chain/engine.ts
 *    playDestinationIsLegal），hold 触发消灭也没有生产接线；绑定期 translateObjectFilter
 *    对 hold 的 here:true 会 fail-closed 抛 Unsupported filter field（programs/filters.ts）。
 * 2. "you may pay :rb_rune_body:" 的指令内 Power 支付：cost.pay 原语已合入
 *    （effects/instructions/cost.pay.ts，CR 203.3 失败必须 throw），但缺 success-gated
 *    payment body，ready 半段仍不能作为「支付成功后」的依赖体执行。
 * 3. "Friendly units here have [Ganking]" 的 static continuous.grant-keyword：
 *    layerFor 已把该 op 映射到 ability 层（programs/statics.ts），缺的只剩把 CardProgram
 *    static 能力接进生产（attachProgramLifecycle/layerFor 已合入，剩主机接线）。
 * 已合入的部分：effect.ready 原语、契约 3.9 的 choice.optional 结构、Ganking 展开、
 * cost.pay 原语、绑定层（programs/triggers.ts、programs/statics.ts、programs/lifecycle.ts）。
 * 依赖：success-gated payment body（契约变更请求，README #2）；生产侧把 CardProgram
 * static/keyword 接进 layers 与打出流程。
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
                id: "portable-portal.ready",
                op: "effect.ready",
                args: {
                  objects: { kind: "constant", value: { kind: "target", id: "portable-portal.unit-here" } },
                  amount: { kind: "constant", value: 1 }
                },
                targets: [
                  {
                    id: "portable-portal.unit-here",
                    filter: { type: "unit", controller: "controller", zone: "board", sameLocationAs: "self" },
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
    "(1) [Deploy]（RIFT-267 的 Deploy.ts 已合入）仍缺生产消费方：830.1.b 的 structured " +
    "continuous.location 不被 playLocations/playDestinationIsLegal 读取（只认名称型 no-battlefield/no-base），" +
    "hold 触发消灭也没有生产接线；绑定期 translateObjectFilter 对 here:true 抛 " +
    "Unsupported filter field（fail-closed）。(2) 「you may pay :rb_rune_body:」是指令内 Power 支付" +
    "（355.10.c.1），cost.pay 原语已合入（CR 203.3 失败必须 throw），但缺 success-gated payment body" +
    "（cost/kinds/README.md 契约变更请求 #2），ready 半段不能凭 linkedTo 门控。" +
    "(3) 「Friendly units here have [Ganking]」的 static continuous.grant-keyword 已能被 layerFor " +
    "映射到 ability 层（programs/statics.ts），缺的只剩把 CardProgram static 能力接进生产的接线。" +
    "已合入的部分：effect.ready 原语、契约 3.9 的 choice.optional 结构、Ganking 关键词展开、" +
    "cost.pay 原语与绑定层（programs/triggers、statics、lifecycle）。不近似实现。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
