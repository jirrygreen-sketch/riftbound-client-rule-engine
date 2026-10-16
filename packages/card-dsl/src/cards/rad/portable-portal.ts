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
 *   以 keyword 能力声明；展开（合法打出位置改写 + hold 触发消灭）由关键词/费用管线负责，
 *   当前 keywords/Deploy.ts 尚未合入。
 * - "When you play this, you may pay :rb_rune_body: to ready a unit here"：383.3.a 的
 *   "you may" → 契约 3.9 的 choice.optional（把被选指令包进 body）；"pay :rb_rune_body:"
 *   是 357 的 Power 费用，"ready a unit here" 用已合入的 effect.ready 原语 + 位置限制的
 *   TargetSpec（"here" = 来源所在位置，用 sameLocationAs: self）。本卡不禁用 "here" 的
 *   范围判定：目标过滤交给目标管线（RIFT-90）。
 * - "Friendly units here have [Ganking]"：810 的静态授予（continuous.grant-keyword /
 *   continuous.movement），需要 layers 与 Ganking 的展开支持。
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
    "三处依赖未合入：(1) [Deploy]（CR 830.1.b 的合法打出位置改写与「对手在此固守时消灭」）没有已合入的" +
    "KeywordDef，卡牌不能自行展开改写费用/位置流程；(2) 「you may pay :rb_rune_body:」需要 Power 费用的" +
    "支付（357/356.7 的 cost.pay 管线，无 cost.pay 原语文件），因此 ready 半段只能作为可审查结构保留；" +
    "(3) 「Friendly units here have [Ganking]」需要 continuous.grant-keyword 持续效果（layers，RIFT-91）与" +
    "Ganking 的展开（RIFT-83）。已合入的部分：effect.ready 原语与契约 3.9 的 choice.optional 结构。" +
    "依赖：RIFT-91、RIFT-83、RIFT-89（费用管线）、Deploy 关键词任务。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
