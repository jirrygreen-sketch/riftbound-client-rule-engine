import type { CardProgram } from "../../ir/index.js";

/**
 * Noxian Drummer (ogn-222-298) — Unit, 3 energy, Might 3（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-222-298）：
 *   When I move to a battlefield, play a 1 :rb_might: Recruit unit token here.
 *   (It is also at the battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 421/449：Move 是对象在两个 Location 之间的移动；449.1/449.2 用起点与终点定义一次移动；
 *   458/458.1 Recall 不是 Move，不触发移动类触发。
 * - 封闭时点 object-moved（events/timing-points.ts，refs 421.1/449.1/449.2/458）用于“成功完成 Move”。
 * - 「play a … token here」：440.2.c/185.2.a/350.2/354（链上生成后打出）；Recruit 见 CR 187.1，
 *   effect.token 定义 id "recruit"。「here」= 来源当前位置（359.3.f.1/f.2）。
 *
 * 结构：object-moved 触发（filter 用 toZone: "battlefield" 表达“移动到战场”）；body[0] 读来源位置，
 * body[1] 在该位置打出 1 个 Recruit token。
 *
 * status = judge-required：object-moved 的触发过滤缺少“是本卡在移动”与“终点是战场”的可判定信息。
 * 见 judgeReason。
 */
const noxianDrummer = {
  canonicalCardId: "card.hash-5518503e78770284d5f2f55292d0d27dd571a336dd4bcae40fdc3ee530d2b12d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "object-moved 时点目前无法表达这张卡的触发条件：(1) events/action-adapter.ts 为 move-location 发出的 " +
    "object-moved 事件不带 source（move-location 动作本身没有 source 字段），因此 " +
    "TriggerSpec 里无法用「来源 = 本卡」表达「When I move」——注册源与事件对象的同一性在 " +
    "event.object 上，而卡牌程序无法静态写出自己的运行时 objectId；" +
    "(2) timing-points.ts 为 object-moved 声明了 toKind/fromKind/toLocationId 等 payloadFields，" +
    "但该发射路径没有填 toZone/toKind，所以 toZone: \"battlefield\" 的过滤永远不命中，" +
    "无法区分“移动到战场”与“从战场移回基地”。" +
    "依赖：RIFT-120 事件管线为 move-location 补齐起点/终点（449.1/449.2、458 Recall 排除）" +
    "并向卡牌注册层暴露“移动对象 = 本卡”。不近似实现（不用任何移动都触发代替）。" +
    "token 部分（effect.token mode play + condition.value 链接位置）已可用并有 golden 执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-moved",
        filter: { event: "object-moved", toZone: "battlefield" }
      },
      optional: false,
      body: [
        {
          id: "noxian-drummer.read-here",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "noxian-drummer.play-recruit",
          op: "effect.token",
          linkedTo: "noxian-drummer.read-here",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "noxian-drummer.read-here",
              key: "here"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I move to a battlefield, play a 1 :rb_might: Recruit unit token here. " +
    "(It is also at the battlefield.)"
} satisfies CardProgram;

export default noxianDrummer;
