import type { CardProgram } from "../../ir/index.js";

/**
 * Time Warp — CR v1.5 734–738 (Additional Turns), 428.1–428.5 (Banish).
 * Play binding and the independent Banish clause are merged. Inserting and
 * consuming a temporary turn in the turn queue remains blocked.
 */
const timeWarp = {
  canonicalCardId: "card.hash-037ac90c7e1ee070f9dea523811caa91e2b1f5c8018e4cc7753149ebb5eba7d7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 734–738 的 Additional Turn 仍缺回合队列插入动作与 turn/ 消费接口：effect.additional-turn 仅为描述 IR，不能在当前回合之后插入临时回合并在完成后恢复原队列。" +
    "CardProgram play 绑定与费用管线已合入；effect.banish 及 source 选择器已有生产链适配器执行证据。整卡仅受额外回合队列语义阻塞，不以跳过阶段或重复 turn-start 近似。",
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
