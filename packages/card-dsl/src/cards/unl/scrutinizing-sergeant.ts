import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scrutinizing Sergeant (unl-157-219) — Unit, Order, energy 6, Might 6,
 * tags Elite/Demacia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-157-219，逐字）:
 *   "When you play me, gain 1 XP for each friendly unit."
 *
 * 规则依据（CR v1.5）:
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect（Condition 含本单位的
 *   触发式能力，420.4.a 规定打出完成后入链）；时点用封闭表的 card-played
 *   （timing-points.ts，ruleRefs 359/383.4.a/407），filter 用内层锚点
 *   source: "self" 指称本卡（与已合入的 sfd/undertitan、sfd/sandshifter、
 *   sfd/trove-golem 同型）。
 * - 728–730.1 / 733："gain 1 XP" 用已合入的 effect.xp；XP 不是 Game Object
 *   （731），获得者缺省是能力控制者（190.6.d 的隐含 you），因此不写 player。
 * - "for each friendly unit"：按 418.8 的 "for each" 口径每名友方单位各计 1，
 *   用 count 表达式在结算时数能力控制者控制的 Board 单位（355.10.d 的
 *   程序化集合，不是目标，故不写 targets/picks）；effect.xp 的 amount 接受该
 *   Expr，实际获得量由原语写入链接值 gained。
 * - "friendly"＝控制者自己的对象（controller 选择器 "self"）：生产链
 *   chain/engine.ts 的 query 覆盖会把 controller/owner 的 self/opponent
 *   归一化为能力控制者（reference 内核按字面比较，golden 用同一归一化规则的
 *   宿主，见测试注释）。
 *
 * status = executable：整张卡所需原语（effect.xp）、表达式（count）、时点
 * （card-played）与关键词需求（无）都已合入，golden 用解释器 + 参考内核真实
 * 执行本卡 body（含对手单位与手牌不计入、0 名友方单位、gain-xp 被替代的边界）。
 * 触发订阅的 CardProgram → 事件管线接线属横切项（RIFT-120 后继），与已合入的
 * rad/bilgewater-tracker、rad/patched-porobot 同口径记为 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "scrutinizing-sergeant.gain-xp",
        op: "effect.xp",
        args: {
          // 730.1 / 733：每名友方单位 1 XP，结算时取值（418.8 的 for each）。
          amount: {
            kind: "count",
            subject: "friendly-units",
            filter: { type: "unit", controller: "self", zone: "board" }
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-767e3dc0c34d8624cb575cc8efa21b261e732ab8e621b197d1672ab785918746",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "When you play me, gain 1 XP for each friendly unit."
} satisfies CardProgram;

export default program;
