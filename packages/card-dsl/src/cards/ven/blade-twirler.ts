import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * blade-twirler — M2 源码复核（2026-10-17）。
 * 具体规则与剩余阻塞见 judgeReason；局部执行不代表整卡可执行。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } },
      // “The first time I move each turn”：383.2.a 的触发条件寿命。
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        id: "blade-twirler.choose-player",
        // 355.9.a/355.10.f 的玩家选择需要 target.player 原语（ability-templates 第 4 节）；
        // effects/instructions/ 下没有该文件，本指令当前无法执行，也不能用 effect.discard
        // 或对象目标近似。
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          linkKey: { kind: "constant", value: "chosenPlayer" }
        }
      },
      {
        id: "blade-twirler.burn-1",
        op: "effect.mill",
        linkedTo: "blade-twirler.choose-player",
        args: {
          // 441.2.a：Burn 1 的牌数是印刷常量 1。
          amount: { kind: "constant", value: 1 },
          // 190.6.d 的 “They” = 被选中的玩家：本应先由 target.player 写入链接值，
          // 再经已支持的 linked-value 读取；目前缺少产生被选玩家的前序指令。
          player: {
            kind: "linked-value",
            instructionId: "blade-twirler.choose-player",
            key: "chosenPlayer"
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-cb21758ecfca99ee0664cb303df5b4bcaf610c851720b908072b2555e533474b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "355.9.a/355.10.f 的结算期玩家选择仍缺 target.player 原语，以及从当前对局枚举全部合法 PlayerId 的绑定；不能把玩家写成对象目标，也不能硬编码玩家 ID。effect.mill 已能消费 linked-value 的 player 参数并通过 choice 发起玩家选择，缺口是合法候选来源及前序 target.player 生产者，而非玩家链接值消费者（190.6.d、441.1/441.2）。",
  abilities,
  sourceText:
    "The first time I move each turn, choose a player. They [Burn 1]. (They put the top card of their " +
    "Main Deck into their trash.)"
} satisfies CardProgram;
