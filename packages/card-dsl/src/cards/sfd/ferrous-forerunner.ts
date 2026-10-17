import type { CardProgram } from "../../ir/index.js";

/**
 * Ferrous Forerunner (sfd-021-221) — Rumble SFD precon unit.
 *
 * [Deathknell] — Play two 3 [M] Mech unit tokens to your base.
 * (When I die, get the effect.)
 *
 * CR 808.1.c defines Deathknell as "When I die, [Effect]". Its explicit
 * object-killed body below retains that source trigger for partial inspection;
 * the generic programs/triggers.ts binding is already merged. The keyword
 * skeleton still delegates body hookup to trigger.leave, and effect.token
 * cannot express the controller's base without a concrete PlayerId.
 * Mech creation/play (187.4/440.2.c/185.2.a) is already executable; the token
 * sub-effect test binds only that unavailable destination to the acting seat.
 */
export default {
  canonicalCardId: "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Mech 定义（187.4）及链上创建/play（440.2.c/185.2.a）已合入；object-killed 的程序 → TriggerRegistration 绑定也已存在，不能继续列为泛化缺口。当前 effect.token 的 LocationRef 必须带实际 PlayerId，无法表达不依赖来源当前战场的「to your base」（本卡仍保留 controller 占位，不能当成 PlayerId 执行）。此外 Deathknell.ts 的关键词骨架引用 trigger.leave，其正文挂接入口尚不可执行（808.1.c）；本卡显式 object-killed 正文只提供子效果结构证据，不证明关键词完整接通。保留 judge-required；请求 effect.token 支持 controller-base 及 Deathknell 正文绑定。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { event: "object-killed", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "ferrous-forerunner.play-tokens",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 2 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "mechTokens" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Deathknell] — Play two 3 :rb_might: Mech unit tokens to your base. (When I die, get the effect.)"
} satisfies CardProgram;
