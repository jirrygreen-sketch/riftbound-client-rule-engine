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
                args: { payments: { kind: "constant", value: { power: ["Fury"] } } }
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
    "（1）combat-result、attack-declared 与 defense-declared 缺战斗结果/宣言发射及自身胜方、攻防身份过滤绑定" +
    "（CR 468.3、407）：本包 ChainEngine/combat flow 上没有这些时点的生产者，实测提交战斗相关动作不会发出对应事件；" +
    "（2）effect.token 尚无 Gold 的完整定义与能力（187.5）：对 \"gold\" 实测 negated 且 blockedReason 为 " +
    "token-definition-or-abilities-judge-required；同时不支持 entersExhausted 入场规定（184.1、185.2.d）——" +
    "该参数不在 ARGUMENTS 集合内，schema 实测抛 \"Invalid effect.token argument: entersExhausted\"；" +
    "（3）token 的 location 只接受常量 LocationRef，不解析 location 表达式（实测抛 " +
    "\"Invalid effect.token argument: location\"），因此 { type: \"base\", player: \"controller\" } " +
    "无法绑定为运行时相对控制者目的地。",
  abilities,
  sourceText:
    "When I win a combat, play a Gold gear token exhausted.\n" +
    "When I attack or defend, you may pay :rb_rune_fury:. If you do, give me +2 :rb_might: this turn."
} satisfies CardProgram;
