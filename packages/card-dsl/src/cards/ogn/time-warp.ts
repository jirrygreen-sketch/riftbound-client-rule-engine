import type { CardProgram } from "../../ir/index.js";

/**
 * Time Warp — CR v1.5 734–738 (Additional Turns), 428.1–428.5 (Banish).
 * 复核 2026-10-17：effect.banish 半段有生产执行证据；effect.additional-turn
 * 至今没有登记在指令注册表，整卡仍被额外回合的队列语义阻塞。
 */
const timeWarp = {
  canonicalCardId: "card.hash-037ac90c7e1ee070f9dea523811caa91e2b1f5c8018e4cc7753149ebb5eba7d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 734–738 的 Additional Turn 仍缺实现（2026-10-17 复核）：" +
    "(1) effect.additional-turn 不是已登记指令——instructions/registry.generated.ts 里没有该 op，" +
    "实测 resolveChainBody 直接抛 \"Unregistered instruction opcode: effect.additional-turn\"，所以这条指令连解释器入口都没有；" +
    "(2) 即便登记，735–738 要求的临时回合插入与消费接口仍不存在：turn/flow.ts 只有 phase/phaseValue 推进，" +
    "没有回合队列（无 turnQueue/额外回合结构），也没有「插入到当前回合之后、完成后恢复原队列」的原语；" +
    "不以跳过阶段或重复 turn-start 近似。" +
    "已合入并有执行证据：CardProgram play 绑定与费用管线，以及独立句的 effect.banish + source 选择器" +
    "（428.1–428.5，实测把本法术移入其拥有者的 Banishment 并留下链接回执）。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Take a turn after this one" — described via the Additional Turn
          // contract shape (734/735). No merged opcode consumes it yet.
          id: "take-turn-after-this",
          op: "effect.additional-turn",
          args: {
            owner: { kind: "constant", value: "controller" },
            after: { kind: "constant", value: "this-turn" }
          }
        },
        {
          // "Banish this." — the source selector resolves to the spell itself;
          // an independent sentence, so no linkedTo (359.3.e.14).
          id: "banish-this",
          op: "effect.banish",
          args: { objects: { kind: "constant", value: "source" } }
        }
      ]
    }
  ],
  sourceText: "Take a turn after this one. Banish this."
} satisfies CardProgram;

export default timeWarp;
