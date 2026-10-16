import type { CardProgram } from "../../ir/index.js";

/**
 * Vayne, Hunter (ogn-035-298) — Unit, Fury, Vayne/Demacia/Champion.
 * energy 4, power 1 (Fury), Might 2.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-035-298):
 *   "[Assault 3] (+3 :rb_might: while I'm an attacker.)\nIf an opponent controls
 *    a battlefield, I enter ready.\nWhen I conquer, you may pay
 *    :rb_energy_1: to return me to my owner's hand."
 *
 * 规则依据（CR v1.5）：
 * - [Assault 3]（807）：攻击时 +3 Might 的被动关键词；展开由 Assault.ts（RIFT-81）
 *   提供，图层由 layers/（RIFT-91）消费。
 * - "If an opponent controls a battlefield, I enter ready."（364.3、369.3）：这是
 *   一个条件被动 + 入场替代效果——条件成立时把"横置入场"替换为"就绪入场"。
 *   用 replacement 能力表达（event object-enters-board，filter 指向自身）。
 * - "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
 *   （383.3.a、383.4.c）："you may pay ... to return me" 是可选效果；按契约 3.9，
 *   "可以……"必须写成 choice.optional 并把被选指令包进 body（不是 choice +
 *   linkedTo）。body 内先支付 1 能量（cost.pay 形状，由费用管线在 Finalize 收取），
 *   再用 effect.zone 的 return-to-hand 形式把我移回拥有者手牌（"my owner's hand"：
 *   effect.zone 的 hand 目的地按拥有者路由，CR 417/124 由内核处理）。
 *
 * status：judge-required。缺："an opponent controls a battlefield" 的 battlefield
 * 控制条件与"enter ready"入场替代的消费管线（replacement.enter 尚未有执行器，
 * effect.ready 明确不参与入场替代）；可选征服体里的成本内付款也需要 cost.modify /
 * 成本内付款许可（383.3.b）的接管。关键词部分（Assault 3）已可结构校验。
 * 不把"enter ready"近似成事后 effect.ready，也不手改费用。
 */
const vayneHunter = {
  canonicalCardId: "card.hash-af6a9ff16e9f4f9849e489bb4ab37b18a1f12ed88da4b151ac85c770eb68d8c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If an opponent controls a battlefield, I enter ready」是入场替代效果（369.3），当前没有 replacement.enter 消费管线；" +
    "effect.ready 明确排除入场替代路径（不能近似为先横置再重置）。条件「an opponent controls a battlefield」还需要 battlefield 控制状态谓词。" +
    "「When I conquer, you may pay :rb_energy_1: to return me」中，可选包装可用 choice.optional，但成本内付款（383.3.b 的 cost within instructions）" +
    "需要费用管线接管支付与回手动作的顺序。依赖：RIFT-91（layers/replacement 消费）、RIFT-89（成本计划与付款）、RIFT-33（征服触发）。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 3 },
    {
      kind: "replacement",
      replaces: {
        event: "object-enters-board",
        filter: { source: "self", exhausted: true }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "battlefields",
          filter: { controller: "opponent" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      },
      with: [
        {
          id: "vayne-hunter.enter-ready",
          op: "effect.ready",
          args: {}
        }
      ]
    },
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "vayne-hunter.may-return",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay :rb_energy_1: to return Vayne to your hand?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "vayne-hunter.pay-1",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 } }
                },
                {
                  id: "vayne-hunter.return-to-hand",
                  op: "effect.zone",
                  linkedTo: "vayne-hunter.pay-1",
                  args: {
                    target: { kind: "constant", value: "vayne-hunter.self" },
                    to: { kind: "constant", value: "hand" }
                  },
                  targets: [
                    {
                      id: "vayne-hunter.self",
                      filter: { source: "self" },
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
  ],
  sourceText:
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
    "If an opponent controls a battlefield, I enter ready.\n" +
    "When I conquer, you may pay :rb_energy_1: to return me to my owner's hand."
} satisfies CardProgram;

export default vayneHunter;
