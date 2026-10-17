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
    "(1) combat-result（468.3）与 attack-declared/defense-declared（407）这三个封闭时点目前只有 timing-points.ts 的声明，" +
    "没有已合入的发射方把战斗结果/宣言交给事件管线（RIFT-124）；object-killed 同理缺 inCombat 载荷。" +
    "(2) 印刷的 Gold gear token（187.5）不在 effect.token 的 DEFINITIONS 表里（当前只有 recruit/sand-soldier/mech/reflection/tentacle），" +
    "执行会得到 negated / blockedReason: token-definition-or-abilities-judge-required。" +
    "(3) token 的 entersExhausted（184.1/185.2.d 入场规定）与 { type: \"base\", player: \"controller\" } 相对控制者记法" +
    "（effect.token 只接受字面 PlayerId 并要求等于 ctx.controller）都未被原语消费。" +
    "cost.pay 的 Fury 域支付与 continuous.might 的 end-of-turn +2 Might 本身已合入并有真实执行测试；" +
    "触发接线的生产方（contract 3.5）未合入。不近似实现。",
  abilities,
  sourceText:
    "When I win a combat, play a Gold gear token exhausted.\n" +
    "When I attack or defend, you may pay :rb_rune_fury:. If you do, give me +2 :rb_might: this turn."
} satisfies CardProgram;
