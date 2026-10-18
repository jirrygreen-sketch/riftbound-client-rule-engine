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
 * - [Assault 2]（807）：攻击时 +2 Might 的被动关键词；展开由已注册的
 *   Assault KeywordDef 提供，攻击者图层在运行时计算。
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
 * 费用计划，不能自行推导）。cost.pay.payments 本身已可执行；Assault 2 展开
 * 仍读取 designation，与快照 combatRole 不一致。不近似实现。
 */
const immortalPhoenix = {
  canonicalCardId: "card.hash-acb364f84a4f3f4cdad5e6ff9db1641d7f71a3989926dd02555f13274d3ec43d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺法术消灭归因与 Trash 活跃窗口（CR 429.5.b/c/d、385.2）：kill 动作没有 " +
    "source，主动消灭原语不传法术来源，清理消灭未贯通法术/伤害归因；programs/triggers.ts 对 object-killed 固定 activeZones: board。count 的 " +
    "kill-sources-this-event 不是事件归因查询。嵌套 Play 还缺在 resulting unit Finalize " +
    "选择合法地点并接入替代费用的窗口，不能用正文提前付款取代该生命周期。[Assault 2] 展开仍读取 designation，而当前快照暴露 combatRole，缺关键词与战斗身份绑定（807.1）。",
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
                    payments: { kind: "constant", value: { energy: 1, power: ["Fury"] } }
                  }
                },
                {
                  id: "immortal-phoenix.play-from-trash",
                  op: "effect.play",
                  linkedTo: "immortal-phoenix.pay",
                  args: {
                    object: { kind: "object-property", object: "self", property: "ref" },
                    cost: { kind: "constant", value: { finalized: true, energy: 0, power: [] } }
                  }
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
