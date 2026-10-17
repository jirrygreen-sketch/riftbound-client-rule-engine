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
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。当前缺口（均实测）：
 * 1. Deploy 的 KeywordDef 已合入（effects/keywords/Deploy.ts），但展开出的两半都没有消费方：static
 *    continuous.location 在 programs/statics.ts 的 layerFor 没有图层映射（实测
 *    createEngineStaticBinder.bindStatic 抛 judge-required「Static ability kind
 *    continuous.location has no layer mapping」），hold 触发的 here:true 被
 *    translateTriggerFilter 拒绝（实测「Unsupported filter field here」），830.1.b 的
 *    打出位置许可与「对手在此固守时消灭」都还进不了链。
 * 2. "you may pay :rb_rune_body:" 的指令内 Power 支付：cost.pay 原语已合入
 *    （effects/instructions/cost.pay.ts，CR 203.3 失败必须 throw），但缺 success-gated
 *    payment body，ready 半段仍不能作为「支付成功后」的依赖体执行；程序里也还没有
 *    cost.pay 指令，支付本身不会发生。
 * 3. "Friendly units here have [Ganking]"：RIFT-257 的生产静态绑定已把该 grant 装进
 *    ability 图层（实测 createProgramBinding → attachProgramLifecycle →
 *    createEngineStaticBinder 的 bindStatic 通过，spec 过滤器把 sameLocationAs: "self"
 *    解析成 { type: "battlefield", id }），但 layers/filter.ts 的 matchesObjectFilter
 *    只按 location.type 字符串比较，结构化 LocationRef 永不匹配——实测同一战场单位也拿不到
 *    Ganking；body 的 TargetSpec 过滤器 sameLocationAs 还被 programs/filters.ts 的
 *    translateObjectFilter 直接拒绝（实测「Unsupported filter field sameLocationAs」）。
 * 已合入的部分：effect.ready 原语、契约 3.9 的 choice.optional 结构、Ganking 展开、
 * cost.pay 原语、绑定层（programs/triggers.ts、programs/statics.ts、programs/lifecycle.ts）。
 * 依赖：success-gated payment body（契约变更请求，README #2）；结构化 location 的图层过滤与
 * 指令目标过滤的 sameLocationAs 翻译。
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
    "(1) [Deploy]（effects/keywords/Deploy.ts 已合入）展开出的两半都没有消费方：static " +
    "continuous.location 在 programs/statics.ts 的 layerFor 无图层映射（实测 bindStatic 抛 " +
    "judge-required「Static ability kind continuous.location has no layer mapping」），" +
    "830.1.b 的打出位置许可进不了链；hold 触发的 here:true 被 translateTriggerFilter 拒绝" +
    "（实测「Unsupported filter field here」），对手在此固守时消灭也绑不上。" +
    "(2) 「you may pay :rb_rune_body:」是指令内 Power 支付（355.10.c.1），cost.pay 原语已合入" +
    "（CR 203.3 失败必须 throw），但缺 success-gated payment body（cost/kinds/README.md 契约变更请求 #2），" +
    "ready 半段不能凭 linkedTo 门控；程序里也还没有 cost.pay 指令，支付本身不会发生。" +
    "(3) 「Friendly units here have [Ganking]」的 static continuous.grant-keyword 已被 RIFT-257 的" +
    "生产绑定装进 ability 图层（实测 createProgramBinding → attachProgramLifecycle → " +
    "createEngineStaticBinder.bindStatic 通过，spec 过滤器把 sameLocationAs:self 解析为 { type: battlefield, id }），" +
    "但 layers/filter.ts 的 matchesObjectFilter 只按 location.type 字符串比较，结构化 LocationRef 永不匹配" +
    "（实测同一战场单位也拿不到 Ganking）；body 的 TargetSpec 过滤器 sameLocationAs 另被 " +
    "programs/filters.ts 的 translateObjectFilter 拒绝（实测「Unsupported filter field sameLocationAs」）。" +
    "已合入的部分：effect.ready 原语、契约 3.9 的 choice.optional 结构、Ganking 关键词展开、" +
    "cost.pay 原语与绑定层（programs/triggers、statics、lifecycle）。" +
    "依赖：success-gated payment body、结构化 location 的图层过滤与指令目标过滤的 sameLocationAs 翻译。不近似实现。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
