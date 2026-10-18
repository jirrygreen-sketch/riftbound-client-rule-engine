import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * K'Sante, Courageous (rad-086-167) — Unit, 5 energy, Might 4, Body,
 * 标签 Shurima/K'Sante/Champion。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional
 *   cost to have me enter ready.)
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   When I hold, channel 1 rune.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]：805 的可选附加费用关键词，费用固定为 [1] + 一个与单位域匹配的 Power
 *   （805.1.b.1），以 keyword 能力（不带数值）声明；展开（accelerate.cost + 入场就绪
 *   替代）由 effects/keywords/Accelerate.ts 负责，实际支付属费用管线。
 * - [Shield 2]：814 的带数值被动关键词，展开由 effects/keywords/Shield.ts 负责。
 * - "When I hold"：383.4.d 的 Hold Effect，时点 hold（315.2.b.2、471.2、473.2.b）。
 * - "channel 1 rune"：431.1/431.2 的 channel 动作，已合入 effect.channel 原语；
 *   未写 exhausted 参数即默认就绪进场（431.2 规定未注明时符文就绪）。
 *
 * status = judge-required（2026-10-17 复核，逐个缺口写出证据，不近似实现）：
 * 1. [Accelerate] 的展开（805.1.b 附加费 [1][Body]、805.6 入场就绪替代）已写成
 *    accelerate.cost 静态效果 + replacement，但没有消费方：programs/statics.ts 的 layerFor
 *    对 accelerate.cost 抛 “Static ability kind accelerate.cost has no layer mapping”，
 *    programs/play.ts 也只从 CostPlanInput 读 optionalAdditional，没有把卡牌 keyword 能力
 *    接入 Finalize 费用计划的卡牌侧生产路径。（replacement 本体可绑定，golden 有执行证据。）
 * 2. [Shield 2] 的 KeywordDef 展开已合入；但展开条件读 object-property(self, "designation")，
 *    而 ObjectSnapshot 只有 combatRole（实测 defender 时 Might 不增加），防守时的 +2 尚未生效。
 * 3. hold 触发缺少「本卡在固守的战场上」的时点载荷：383.4.d.2/.2.a 要求 Hold Effect 绑定
 *    固守时在场的那个单位。触发注册本身可用（filter 编译成 objectId 形式的 {event:"hold", object:{objectId}}），
 *    但时点 hold 由 scoring 发出，载荷只带 battlefieldId/playerId（events/timing-points.ts 未为 hold 声明 payloadFields），
 *    实测该 filter 对带载荷的真实 hold 事件判定为 false，因此本卡永远无法判定自己参与固守。
 * 已合入并已有执行证据的部分：effect.channel（431）——golden 用解释器 + 参考内核真实执行
 * 该 channel（含 431.3 的空符文牌库边界）。
 * 当前缺口是 Accelerate 静态费用到打出 Finalize 的 optionalAdditional 适配，以及 hold
 * 事件缺少用于绑定“固守时在场单位”的 object/source 载荷。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "shield", value: 2 },
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      // 与已合入的 sfd/rumble-scrapper.ts 同型：订阅 hold 时点并把来源限定为自身；
      // "本卡是固守时在场的那个单位"（383.4.d.2）仍是未合入的部分（见 judgeReason）。
      filter: { event: "hold", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "ksante-courageous.channel",
        op: "effect.channel",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5a036961fb00b9d4befa78e1fb2d424a4647453d50975b08ec9edb34881c6035",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口：(1) [Accelerate] 展开（805.1.b 的附加费 [1][Body] 与 805.6 入场就绪替代）虽已写在 " +
    "effects/keywords/Accelerate.ts，但 accelerate.cost 静态效果绑定即抛 “Static ability kind accelerate.cost has no layer mapping”" +
    "（programs/statics.ts 的 layerFor），programs/play.ts 也只从 CostPlanInput 读 optionalAdditional，没有卡牌侧生产方" +
    "把该静态费用声明接入打出 Finalize；805.6 的入场就绪替代本体可绑定（golden 有执行证据）。" +
    "(2) [Shield 2]（814）的 KeywordDef 展开已合入，但条件读 object-property(self, \"designation\")，" +
    "ObjectSnapshot 只有 combatRole：解释器抛 MissingInformation、生产绑定器按 false 处理（实测 defender 时 Might 不增加）。" +
    "(3) hold 触发缺少「本卡在固守的战场上」的载荷：383.4.d.2/.2.a 要求 Hold Effect 绑定固守时在场的单位，" +
    "而 hold 时点（turn/flow.ts 的 scoring）载荷只带 battlefieldId/playerId（events/timing-points.ts 未为 hold 声明 payloadFields，实际事件不含 object），" +
    "实测注册出的 {event:\"hold\", object:{objectId}} filter 对真实 hold 事件判定为 false，无法判定本卡参与固守。" +
    "已合入并有执行证据：effect.channel（431.1/431.2，含 431.3 空符文牌库边界），见 golden。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When I hold, channel 1 rune."
} satisfies CardProgram;

export default program;
