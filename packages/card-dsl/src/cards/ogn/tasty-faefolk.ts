import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Tasty Faefolk (ogn-075-298), printed power null (not zero).
 * CR v1.5 805 / 808 / 431.2-431.3 / 414.1.
 * KeywordAbility has no payload slot. Keep the card-specific instructions as
 * pure data until RIFT-1/82 defines that association; do NOT register a second
 * object-killed trigger beside the Deathknell keyword. No keyword is expanded here.
 * The production chain adapter (resolveChainBody) can execute this raw body;
 * the remaining gap is binding it to the Deathknell trigger payload.
 * Channel and draw are independent instructions, with no linkedTo. The merged
 * effect.channel primitive carries the printed exhausted stipulation to the
 * channel-rune action; the reference kernel records that action for the golden.
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
  judgeReason: "Accelerate 与 Deathknell 的 KeywordDef 已合入（RIFT-265），effect.channel 与 effect.draw 也已合入并由 golden 驱动；原始 deathknellBody 可通过生产链入口 resolveChainBody 顺序执行，仍有三处生产缺口，均不近似实现：(1) Deathknell 的卡牌专属 payload 与 trigger.leave 展开没有唯一绑定契约，契约 3.1 的 KeywordAbility 无 body/payload 字段，死亡效果只能暂存为纯数据 deathknellBody（CR 808；RIFT-1/82）；(2) Deathknell 展开仍引用未注册的 trigger.leave 原语，死亡触发的离场订阅与替代处理不能执行（CR 808.1.d；RIFT-82）；(3) Accelerate 的附加费用与就绪入场替代仍需 play/Finalize/Replacement 生产端接线（CR 805；RIFT-89/120）。effect.channel 会把 exhausted:true 传入 channel-rune 动作，effect.draw 子效果可执行；整卡保持 judge-required。",
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
