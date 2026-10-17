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
 * - "Friendly units here have [Ganking]"：810 的静态授予（continuous.grant-keyword，
 *   RIFT-258；Ganking 本身的展开由 RIFT-83/86 的 Ganking.ts 提供）。
 * - "you may pay :rb_rune_body:"：357 的 Power 费用；效果内支付属 [do X] to [do Y]
 *   的指令内费用（355.10.c.1），需要 cost.pay 这类指令原语（RIFT-261 仍在进行）。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。当前缺口：
 * 1. Deploy 的 KeywordDef 已合入（RIFT-267），但 continuous.location 的合法打出位置
 *    与 hold 触发消灭仍无消费方（Finalize/Cleanup/触发注册均未接线，RIFT-120）。
 * 2. "you may pay :rb_rune_body:" 的指令内 Power 支付没有已注册的 cost.pay 类原语
 *    （effects/instructions/ 无该 op；RIFT-261 进行中），ready 半段只有结构证据。
 * 3. "Friendly units here have [Ganking]" 的 static continuous.grant-keyword 没有把
 *    CardProgram static 能力注册进 layers 的入口（RIFT-120/257），图层本身
 *    （RIFT-258/259 的 addContinuous 与 continuous.movement）已合入。
 * 已合入的部分：effect.ready 原语、契约 3.9 的 choice.optional 结构、Ganking 展开。
 * 依赖：RIFT-120（触发/静态注册接线）、RIFT-261（指令内 Power 支付）。
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
    "(1) [Deploy]（RIFT-267 的 Deploy.ts 已合入）仍缺消费方：830.1.b 的合法打出位置" +
    "（continuous.location）没有 Finalize 校验消费者，hold 触发消灭也没有注册进事件管线" +
    "（RIFT-120 / 契约 §7.2 批 5）。(2) 「you may pay :rb_rune_body:」是指令内 Power 支付" +
    "（355.10.c.1），effects/instructions/ 仍无 cost.pay 类原语（RIFT-261 进行中），" +
    "ready 半段只有可审查结构。(3) 「Friendly units here have [Ganking]」的 static " +
    "continuous.grant-keyword（RIFT-258 已合入该 op 与图层消费）仍缺 CardProgram static " +
    "能力 → layers 的注册入口（RIFT-120/257）。已合入的部分：effect.ready 原语、" +
    "契约 3.9 的 choice.optional 结构与 Ganking 关键词展开。不近似实现。",
  abilities,
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, you may pay :rb_rune_body: to ready a unit here.\n" +
    "Friendly units here have [Ganking]. (They can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
