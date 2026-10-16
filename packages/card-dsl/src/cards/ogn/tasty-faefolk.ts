import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Tasty Faefolk (ogn-075-298), printed power null (not zero).
 * CR v1.5 805 / 808 / 431.2-431.3 / 414.1.
 * KeywordAbility has no payload slot. Keep the card-specific instructions as
 * pure data until RIFT-1/82 defines that association; do NOT register a second
 * object-killed trigger beside the Deathknell keyword. No keyword is expanded here.
 * Channel and draw are independent instructions, with no linkedTo.
 * The reference kernel currently ignores channel-rune.exhausted (RIFT-46).
 */
export const deathknellBody = [
  {
    id: "channel-runes",
    op: "effect.channel",
    args: {
      amount: {
        kind: "constant",
        value: 2
      },
      exhausted: {
        kind: "constant",
        value: true
      }
    }
  },
  {
    id: "draw-card",
    op: "effect.draw",
    args: {
      amount: {
        kind: "constant",
        value: 1
      }
    }
  }
] satisfies readonly Instruction[];

const program = {
  canonicalCardId: "card.hash-bcc76f0b1b3b8dafd184b4a3307e12e03a80d4c9902254de9e30a4f6b0f1aba2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "Accelerate/Deathknell 已有展开文件，但 lowercase KeywordId 与注册表大小写尚未统一；Deathknell 的卡牌专属 payload 与 trigger.leave 展开没有唯一绑定契约（CR 808；RIFT-1/82）。Accelerate 的附加费用与就绪入场替代仍需 RIFT-89/120 接线（CR 805，不能先入场再 ready）。effect.draw 子效果可执行；effect.channel 虽提交 exhausted:true，但 RIFT-46 参考内核的 channel-rune 忽略该字段，不能先就绪入场再横置补偿。原始 body 的解释器求值与 Expr schema 接口仍需 RIFT-1/120 统一；不宣称整卡执行。契约 3.1 的 KeywordAbility 无 body/payload 字段，故死亡效果单独导出为纯数据 deathknellBody，未在 CardProgram 中重复注册死亡触发。",
  abilities: [
    {
      kind: "keyword",
      keyword: "accelerate"
    },
    {
      kind: "keyword",
      keyword: "deathknell"
    }
  ],
  sourceText: "[Accelerate] (You may pay :rb_energy_1::rb_rune_calm: as an additional cost to have me enter ready.)\n[Deathknell] — Channel 2 runes exhausted and draw 1. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
