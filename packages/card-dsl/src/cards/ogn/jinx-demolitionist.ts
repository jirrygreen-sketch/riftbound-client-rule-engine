import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Demolitionist (ogn-030-298) — Unit, Fury, Jinx/Zaun/Champion.
 * energy 3, power 1 (Fury), Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-030-298):
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional
 *   cost to have me enter ready.)\n[Assault 2] (+2 :rb_might: while I'm an
 *   attacker.)\nWhen you play me, discard 2."
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词；展开（accelerate.cost 静态声明 +
 *   入场就绪替代）由 effects/keywords/Accelerate.ts 提供（RIFT-86 已合入），
 *   费用计划由 cost/ 的 optionalAdditional accelerate 分支接管（RIFT-89）。
 *   卡只声明 keyword，不重写展开。
 * - [Assault 2]（807.1.b/.c）：攻击时 +2 Might 的被动关键词；展开由
 *   effects/keywords/Assault.ts（RIFT-81）提供，图层由 layers/（RIFT-91）消费，
 *   卡只声明 keyword 与数值。
 * - "When you play me, discard 2."：打出触发（383.4.a，时点 card-played，filter
 *   指向自身）；"discard 2" 是效果弃牌（423，非费用），用已合入的 effect.discard
 *   原语表达——数量为印刷常量 2，弃牌者缺省为能力控制者（190.6.d），超量时按
 *   能弃多少弃多少（423.4）；选择由原语的 replayable choice 完成。
 *
 * status：executable——两张关键词展开与弃牌原语均已合入，golden 测试对弃牌体做
 * 真实执行（参考内核 + effect.discard），关键词部分做结构断言。
 */
const jinxDemolitionist = {
  canonicalCardId: "card.hash-ebb7c06b81cac9f92ad088fcd2b809aa1e4f83f98e4ae2bbe3ad591e7259a141",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "assault", value: 2 },
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "jinx-demolitionist.discard-2",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "When you play me, discard 2."
} satisfies CardProgram;

export default jinxDemolitionist;
