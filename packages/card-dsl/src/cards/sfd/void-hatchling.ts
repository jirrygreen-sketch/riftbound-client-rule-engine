import type { Ability, CardProgram } from "../../ir/index.js";

/** Void Hatchling (sfd-018-221). */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "card-revealed", filter: { source: "self", zone: "deck" } },
    with: [
      {
        id: "void-hatchling.look-top-card",
        op: "effect.inspect",
        args: {
          player: { kind: "object-property", object: "source", property: "controller" },
          zone: { kind: "constant", value: "deck" },
          scope: { kind: "constant", value: "top" },
          amount: { kind: "constant", value: 1 },
          picksSpecId: { kind: "constant", value: "void-hatchling.top-card" },
          choiceId: { kind: "constant", value: "void-hatchling.look" },
          linkedKey: { kind: "constant", value: "looked" },
          pickedKey: { kind: "constant", value: "looked-at" }
        }
      },
      {
        id: "void-hatchling.may-recycle",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Recycle the looked-at top card?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "void-hatchling.recycle",
                op: "effect.recycle",
                args: {
                  objects: {
                    kind: "linked",
                    instructionId: "void-hatchling.look-top-card",
                    key: "looked-at"
                  }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-4ab01377c65974a5fddcfffca25ef87c9b2148a25edc4b988270578e5b0c26a0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『If you would reveal cards from a deck』需要 replacement.enter/reveal 的卡牌程序注册（RIFT-120），且『those cards』必须绑定被替代 Reveal 事件实际要展示的对象集合；当前 ObjectSelector 没有替代事件对象选择符。" +
    "look at the top card 还需要上游用 zoneSlice 提供有序牌库顶 pick（RIFT-66 后续接线）；可选 recycle 体保留为真实原语结构，最终 reveal 与事件对象绑定未近似实现。",
  abilities,
  sourceText: "If you would reveal cards from a deck, look at the top card first. You may recycle it. Then reveal those cards."
} satisfies CardProgram;
