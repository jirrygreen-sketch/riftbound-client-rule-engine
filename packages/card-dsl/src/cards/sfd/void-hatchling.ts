import type { Ability, CardProgram } from "../../ir/index.js";

/** Void Hatchling (sfd-018-221). */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "card-revealed", player: "self", filter: { zone: "deck" } },
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
    "card-revealed 替代仍缺整次 reveal 意图（发起玩家、原牌库拥有者、原请求数量）的绑定和恢复执行：当前 reveal action 逐对象发出，replacement.object 只绑定单个被替代对象，不能表达先查看/可选回收后再按原请求展示。现有 replacement 注册已合入，但 replacement/planner.ts 不支持 effect.inspect、choice.optional、effect.recycle 组成的替代体（425.1/425.3、417.1）。effect.inspect 的参数 schema 仍只接受运行时 ObjectRef 的 object-property，尚未接通 source 选择器；source.controller 也不能代替原 reveal 的牌库拥有者；有序 picks 依赖 RIFT-358。当前 EventPattern 的 player:self 仅记录发起玩家意图，尚需对象事件路径实际匹配该 player。不近似实现。",
  abilities,
  sourceText: "If you would reveal cards from a deck, look at the top card first. You may recycle it. Then reveal those cards."
} satisfies CardProgram;
