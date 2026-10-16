import type { CardProgram } from "../../ir/index.js";

/** Armed Assailant (sfd-002-221). */
export default {
  canonicalCardId: "card.hash-8518a281524e1e72c165821192f2957a4ce78725737d98dbb03e70569739aec0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Accelerate] 的 KeywordDef 已声明 accelerate.cost 与入场替代形状，但缺少把卡牌关键词接入打出费用与 replacement.enter 管线的生产接线（RIFT-89/RIFT-120）；" +
    "[Weaponmaster] 需要 821.1.c 的 cost.modify、cost.pay 与 Attach 流程，当前没有对应费用原语或卡牌关键词消费方（RIFT-9/RIFT-89）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "weaponmaster" }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;
