import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Profiteer (ven-082-166) — Unit, 4 Energy, Might 4, Body, tag Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-082-166，逐字）：
 *   When you play me, you may disempower something you control to empower a
 *   legend, unit, or gear.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 383.4.a.1 / 420.4.a：“When you play me” 是 Play Effect，在打出动作
 *   完成后进链；封闭时点 "card-played"（events/timing-points.ts，ruleRefs 359/407）承载它。
 * - 403.1 / 契约 3.9：效果首段的 "you may" 是触发能力自身的可选执行（TriggeredAbility.optional
 *   = true），被选指令包进 choice.optional 的 body。
 * - 740.4.a：“you may disempower something you control to empower …” 是 "[do X] to [do Y]"
 *   结构——[do X] = disempower 一个你控制的对象（费用），[do Y] = empower 一个 legend/unit/gear
 *   （效果）；740.4.a.2 规定触发能力效果首段的费用在 Finalization 支付，故费用写成费用计划
 *   （cost.pay 的 payments，形状同 sfd/blade-dancer、sfd/chem-baroness），不是结算时的状态改变。
 * - 355.10.c / 355.10.c.1：只作为费用出现的对象不算目标，因此 "something you control" 是
 *   非目标选择（PickSpec），不是 TargetSpec。
 * - 355.7 / 355.9：“empower a legend, unit, or gear” 由玩家指名具体对象 → 目标选择。
 * - 442.1 / 442.2.a：把对象变为 Empowered 的 Empower 动作；443.1 定义 Disempower；
 *   两者都是 Limited Action（442.3.a / 443.2.a），只在游戏效果指示时执行。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * 已支持部分：effect.empower 是已合入原语，golden 用真实解释器 + 参考内核执行 "empower a
 * legend, unit, or gear" 半段（锁定选择由 Finalize 提供）；拒绝分支同样用真实解释器执行；
 * card-played 触发的注册与匹配（383.4.a / 407）已合入（RIFT-120 批次的 chain/events 管线），
 * golden 用真实 EventPipeline 断言本卡的 filter 命中打出事件。
 * 缺口见 judgeReason，不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a：“When you play me” 指打出本卡的事件；filter 用契约 3.6 的符号选择器
      // { source: "self" } 指向能力来源，不写运行时 ObjectRef。
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "profiteer.may-trade-status",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Disempower something you control to empower a legend, unit, or gear?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "profiteer.pay-disempower",
                // 740.4.a.2：触发能力效果首段的费用在 Finalization 支付。disempower 是
                // 443.2 的 Limited Action；当前 cost/plan-values.ts 的非标准费用种类只支持
                // exhaust/discard/recycle/kill/reveal/spend-buff，没有 disempower
                //（同 ven-143-166 Master of Shadows），且 cost.pay 没有已合入的原语文件
                //（RIFT-89）。形状如实记录，不把费用降级成结算效果。
                op: "cost.pay",
                args: {
                  payments: {
                    kind: "constant",
                    value: [
                      {
                        kind: "disempower",
                        // 355.10.c：只作为费用出现的对象不指向目标 → 非目标选择。
                        // "something you control" = 你控制的任一 Board 对象（442.2 的
                        // Empowered 是 Board 上对象的状态）。
                        choice: {
                          id: "profiteer.disempower-choice",
                          options: ["board-object-you-control"],
                          filter: { zone: "board", controller: "self" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      }
                    ]
                  }
                }
              },
              {
                id: "profiteer.empower-target",
                op: "effect.empower",
                linkedTo: "profiteer.pay-disempower",
                args: {
                  // "empower [a legend, unit, or gear]"：442.1 的 Empower 动作；对象是
                  // Finalize 锁定、Resolve 重验后的目标（355.7/355.9）。
                  objects: {
                    kind: "constant",
                    value: { kind: "target", id: "profiteer.legend-unit-or-gear" }
                  }
                },
                targets: [
                  {
                    id: "profiteer.legend-unit-or-gear",
                    // "a legend, unit, or gear"：三类对象的析取。原文没有控制者限制。
                    // 355.9.a："unit"/"gear" 默认指 Board 上的对象，"legend" 指 Legend Zone
                    // 中的传奇——契约 ZoneId 没有 legend-zone（108.3 的遗漏），因此不写 zone 键
                    // （写 "board" 会把传奇排除在外），缺口见 judgeReason。
                    filter: { type: ["legend", "unit", "gear"] },
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
  }
];

export default {
  canonicalCardId: "card.hash-f011b0eba0d960f743fcc486af923c64f5eb0128c2d7d5ff267454e665d10897",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 费用步骤不可执行——“disempower something you control” 是 740.4.a 的费用（740.4.a.2 在" +
    "Finalization 支付），但 cost/plan-values.ts 的非标准费用种类只有 exhaust/discard/recycle/kill/reveal/" +
    "spend-buff，没有 disempower（443.2.a），所以 cost.pay 原语无法支付这笔费用（RIFT-89 的支付种类缺口，" +
    "同 ven-143-166 Master of Shadows）；(2) legend 目标无法结算——" +
    "目标里的 legend 指 Legend Zone（355.9.a.4），契约 ZoneId 没有 legend-zone（108.3），effect.empower 的" +
    "isBoardObject 只接受 Board 对象，所以传奇目标当前无法结算——依赖契约补充与 RIFT-91/RIFT-90 的图层/目标管线。" +
    "已支持部分：effect.empower 本体（442.1）与拒绝分支的 choice.optional（403.1）都由 golden 用真实解释器 +" +
    "参考内核执行。不近似实现（不把费用写成结算效果，也不把传奇排除在目标类型之外）。",
  abilities,
  sourceText:
    "When you play me, you may disempower something you control to empower a legend, unit, or gear."
} satisfies CardProgram;
