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
 *   替代）由 effects/keywords/Accelerate.ts 负责，实际支付属 RIFT-89 的费用管线。
 * - [Shield 2]：814 的带数值被动关键词，展开由 RIFT-81 的 Shield.ts 负责。
 * - "When I hold"：383.4.d 的 Hold Effect，时点 hold（315.2.b.2、471.2、473.2.b）。
 * - "channel 1 rune"：431.1/431.2 的 channel 动作，已合入 effect.channel 原语；
 *   未写 exhausted 参数即默认就绪进场（431.2 规定未注明时符文就绪）。
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
    "hold 触发缺少「本卡在固守的战场上」的时点载荷：CR v1.5 383.4.d.2/.2.a 要求 Hold Effect 绑定" +
    "固守时在场的那一个单位（时点 hold 由 scoring 发出，载荷只带战场/玩家，不含在场单位快照），" +
    "当前触发管线无法判定是本卡参与固守，故不能安全地订阅。hold 触发的 effect.channel（431）主体本身" +
    "已合入并在 golden 测试中真实执行；[Accelerate]（805，RIFT-86 的关键词文件 + RIFT-89 费用管线）与" +
    "[Shield 2]（814，RIFT-81）的展开也尚未落地。依赖：RIFT-31/33（scoring/triggers 的 hold 载荷）、" +
    "RIFT-86、RIFT-89、RIFT-81。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When I hold, channel 1 rune."
} satisfies CardProgram;

export default program;
