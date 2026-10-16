import type { Ability, CardProgram } from "../../ir/index.js";

/** Draven, Vanquisher (sfd-020-221). */
const goldToken = {
  id: "draven-vanquisher.play-gold",
  op: "effect.token",
  args: {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "controller" } },
    entersExhausted: { kind: "constant", value: true }
  }
} as const;

function combatBuff(id: string, at: "attack-declared" | "defense-declared"): Ability {
  return {
    kind: "triggered" as const,
    trigger: { at, filter: { event: at, filter: { source: "self" } }, once: "per-combat" as const },
    optional: false,
    body: [
      {
        id: `${id}.may-buff`,
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay :rb_rune_fury: to get +2 Might this turn?" },
          body: {
            kind: "constant",
            value: [
              {
                id: `${id}.pay-fury`,
                op: "cost.pay",
                args: { power: { kind: "constant", value: ["Fury"] } }
              },
              {
                id: `${id}.might`,
                op: "continuous.might",
                linkedTo: `${id}.pay-fury`,
                args: {
                  amount: { kind: "constant", value: 2 },
                  duration: { kind: "constant", value: "end-of-turn" }
                }
              }
            ]
          }
        }
      }
    ]
  };
}

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "combat-result", filter: { event: "combat-result", filter: { source: "self", result: "win" } } },
    optional: false,
    body: [goldToken]
  },
  combatBuff("draven-vanquisher.attack", "attack-declared"),
  combatBuff("draven-vanquisher.defense", "defense-declared")
];

export default {
  canonicalCardId: "card.hash-7aaef8697b1c10cad90fa125e7e906fb3e4902535478b033c827f7fcf6f94aa8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "胜利战斗触发需要 combat-result 对单位胜负的事件对象绑定（468.3），并播放 Gold gear token；Gold 定义、链上 token 创建、exhausted 入场覆盖均未合入（RIFT-62/RIFT-89）。" +
    "攻击/防御能力需要 cost.pay、临时 continuous.might 与本回合期限（RIFT-89/RIFT-91），且这些触发的生产接线尚未完成。保留已知结构，不近似实现。",
  abilities,
  sourceText:
    "When I win a combat, play a Gold gear token exhausted.\n" +
    "When I attack or defend, you may pay :rb_rune_fury:. If you do, give me +2 :rb_might: this turn."
} satisfies CardProgram;
