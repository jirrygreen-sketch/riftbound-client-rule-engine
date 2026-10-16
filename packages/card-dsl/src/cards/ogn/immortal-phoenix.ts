import type { CardProgram } from "../../ir/index.js";

/**
 * Immortal Phoenix (ogn-037-298) — Unit, Fury, Spirit.
 * energy 3, power 1 (Fury), Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-037-298):
 *   "[Assault 2] (+2 :rb_might: while I'm an attacker.)\nWhen you kill a unit with
 *    a spell, you may pay :rb_energy_1::rb_rune_fury: to play me from your trash."
 *
 * 规则依据（CR v1.5）：
 * - [Assault 2]（807）：攻击时 +2 Might 的被动关键词；展开由 Assault.ts
 *   （RIFT-81）提供，图层由 layers/（RIFT-91）消费。
 * - 383.2.c.1（官方示例即 Immortal Phoenix）："When you kill a unit with a
 *   spell" 在一个由你操控的法术造成消灭时触发；能力在 Phoenix 位于 Trash 时
 *   依然活跃（385.2：场外触发能力自述上下文）——因此触发 filter 需要 zone 锚定
 *   到 trash，时点用 object-killed，并需要下列统计：① 消灭由法术（而不是战斗
 *   伤害或能力）归因（429.5.c、429.5.d 的归因规则）；② 消灭者是本卡控制者。
 * - "you may pay :rb_energy_1::rb_rune_fury: to play me from your trash"
 *   （383.3.a）："you may" 是效果首段的可选执行，按契约 3.9 写 choice.optional
 *   包住 body；body 内先支付 1 能量 + 1 Fury 力量（CostSpec/cost.pay），再用
 *   effect.play 从 Trash 打出本卡（"play me from your trash"，420.3 的有限动作）。
 *
 * status：judge-required。缺：① "killed with a spell" 的归因 + 控制者条件
 * （需要消灭事件载荷的 source 类型与控制者投影，429.5.c.1/.c.2）；② Trash 中
 * 触发能力的注册与在正确时机检查（385.2）；③ 从 Trash 打出时的费用支付与
 * 入场流程（cost.pay 计划由 Finalize 生成；effect.play 要求已 Finalize 的
 * 费用计划，不能自行推导）。依赖：RIFT-257（CardProgram 场外触发注册与归因接线）、
 * RIFT-261（费用计划/支付）。Assault 2 关键词部分已可结构校验。不近似实现。
 */
const immortalPhoenix = {
  canonicalCardId: "card.hash-acb364f84a4f3f4cdad5e6ff9db1641d7f71a3989926dd02555f13274d3ec43d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「When you kill a unit with a spell」需要消灭事件的归因与控制者载荷（CR 429.5.c/.d：消灭由法术归因、" +
    "由谁负责），并需要在 Trash 中注册/检查该场外触发能力（385.2、383.2.c.1 的官方 Immortal Phoenix 示例）；" +
    "「you may pay 1+Fury to play me from your trash」还需要费用计划（Finalize 生成）与 effect.play 的已 Finalize 费用，" +
    "当前没有原语把可选的成本内付款接到 Trash 打出流程（383.3.b）。依赖：RIFT-257（场外触发注册与消灭归因）、RIFT-261（费用计划/支付）。" +
    "[Assault 2] 关键词展开（RIFT-81/91）已合入。不近似实现——不手改 Trash/Zone，也不假造费用。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          filter: { zone: "board", type: "unit" }
        },
        condition: {
          kind: "all",
          conditions: [
            {
              kind: "compare",
              left: {
                kind: "count",
                subject: "kill-sources-this-event",
                filter: { type: "spell", controller: "controller" }
              },
              operator: "gte",
              right: { kind: "constant", value: 1 }
            },
            {
              kind: "compare",
              left: {
                kind: "object-property",
                object: "self",
                property: "zone"
              },
              operator: "eq",
              right: { kind: "constant", value: "trash" }
            }
          ]
        }
      },
      optional: false,
      body: [
        {
          id: "immortal-phoenix.may-play",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Pay :rb_energy_1::rb_rune_fury: to play Immortal Phoenix from your trash?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "immortal-phoenix.pay",
                  op: "cost.pay",
                  args: {
                    energy: { kind: "constant", value: 1 },
                    power: { kind: "constant", value: ["Fury"] }
                  }
                },
                {
                  id: "immortal-phoenix.play-from-trash",
                  op: "effect.play",
                  linkedTo: "immortal-phoenix.pay",
                  args: {
                    target: { kind: "constant", value: "immortal-phoenix.self-in-trash" },
                    cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } }
                  },
                  targets: [
                    {
                      id: "immortal-phoenix.self-in-trash",
                      filter: { source: "self", zone: "trash" },
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
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "When you kill a unit with a spell, you may pay :rb_energy_1::rb_rune_fury: to play me from your trash."
} satisfies CardProgram;

export default immortalPhoenix;
