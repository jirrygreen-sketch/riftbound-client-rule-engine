import type { CardProgram, Instruction } from "../../ir/index.js";

/**
 * Tasty Faefolk (ogn-075-298), printed power null (not zero).
 * CR v1.5 805 / 808 / 431.2-431.3 / 414.1.
 * KeywordAbility has no payload slot, and programs/keywords.ts does not bind a
 * card-specific body to Deathknell's trigger.leave skeleton. Keep the body as
 * pure data and declare the keyword once (CR 808.1.b.1 / 808.2).
 * resolveChainBody executes the independent channel/draw instructions in order.
 * effect.channel forwards exhausted:true, but the reference kernel's
 * channel-rune handler only changes zones; exhausted entry still needs evidence.
 * Generic entry replacements and the duel Accelerate play paths exist, but
 * programs/play.ts does not consume accelerate.cost or bind its paid delayed
 * replacement to this CardProgram (CR 805.2.b / 805.6.a).
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
  judgeReason:
    "Deathknell 的卡牌专属 payload 与关键词展开仍缺唯一绑定契约：KeywordAbility 无 body/payload 字段，" +
    "programs/keywords.ts 仅传 keyword/value/host，Deathknell.ts 的触发体仍引用未注册的 trigger.leave，" +
    "不能把 deathknellBody 绑定为唯一死亡触发并验证离场前 LKI 与被替代死亡的移除（CR v1.5 808.1.b.1/808.1.d.1-3）。" +
    "Accelerate 的 accelerate.cost 尚未接入 programs/play.ts 的可选附加费用，programs/statics.ts 也无该静态种类的图层映射；" +
    "仍缺支付 1 Energy + 匹配 Calm 的 1 Power 后才生效的延迟就绪入场替代绑定（805.1.b.1/805.2.b/805.6.a）。" +
    "replacement/bind.ts 的通用入场替代与 duel/cardplay-unit-v2.ts、cardplay-unit-chain-v4.ts 的 Accelerate 路径不能代替该 CardProgram 接线。" +
    "effect.channel 已传递 exhausted:true，但 effects/testing/test-kernel.ts 的 channel-rune 处理只迁区、未应用该入场状态，" +
    "横置补给仍缺实际执行证据（431.2）；原始 channel/draw 顺序与独立抽牌子效果已有执行测试。",
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
