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
 * status = judge-required（逐个缺口写出证据，不近似实现）：
 * 1. [Accelerate] 的展开（805.1.b 附加费 [1][Body]、805.6 入场就绪替代）已写成
 *    accelerate.cost 静态效果 + replacement，但没有消费方：没有卡牌 keyword 能力接入
 *    Finalize 费用计划（optionalAdditional）的卡牌侧生产路径。
 * 2. [Shield 2] 的 KeywordDef 展开、静态绑定和 combatRole 判定路径已经合入。
 * 3. hold 触发缺少「本卡在固守的战场上」的时点载荷：383.4.d.2/.2.a 要求 Hold Effect 绑定
 *    固守时在场的那个单位（时点 hold 由 scoring 发出，载荷只带战场/玩家，不含在场单位快照，
 *    events/pipeline-match.ts 也只读 object/source/target/player/fromZone/toZone/amount/details，
 *    不读卡程序 filter 里的内层 source: "self"），当前触发管线无法判定是本卡参与固守。
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
    "三处未合入依赖：(1) [Accelerate] 展开（805.1.b 的附加费 [1][Body] 与 805.6 入场就绪替代）虽已写在 " +
    "effects/keywords/Accelerate.ts，但没有消费方把卡牌 keyword 能力接入 Finalize 费用计划（optionalAdditional）与入场替代，" +
    "但当前没有适配器把该静态费用声明接入打出 Finalize 的 optionalAdditional。(2) [Shield 2]（814）的 KeywordDef 展开、" +
    "静态绑定和 combatRole 判定路径已经合入。(3) hold 触发缺少" +
    "「本卡在固守的战场上」的载荷：383.4.d.2/.2.a 要求 Hold Effect 绑定固守时在场的单位，而 hold 时点（turn/flow.ts 的 scoring）" +
    "只带战场/玩家，events/pipeline-match.ts 也不读卡程序 filter 里的内层 source: self，无法判定本卡参与固守。" +
    "已合入并有执行证据：effect.channel（431.1/431.2，含 431.3 空符文牌库边界），见 golden。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When I hold, channel 1 rune."
} satisfies CardProgram;

export default program;
