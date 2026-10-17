import type { CardProgram } from "../../ir/index.js";

/**
 * Ferrous Forerunner (sfd-021-221) — Rumble SFD precon unit.
 *
 * [Deathknell] — Play two 3 [M] Mech unit tokens to your base.
 * (When I die, get the effect.)
 *
 * The Deathknell keyword (CR v1.5 808, "When I die, [Effect]") is owned by
 * RIFT-82 (kw-deathknell-legion). This program expresses the Deathknell
 * effect body explicitly as a triggered ability: the host dying emits the
 * object-killed timing point (payload filter role "self", per the RIFT-21
 * timing-point contract), which is exactly the event Deathknell subscribes
 * to.
 *
 * "Play two 3 [M] Mech unit tokens to your base" plays the 3-Might Mech token
 * (CR v1.5 187.4) at the controller's base. The merged effect.token now
 * chains create-token(to: chain) with the play hand-off (440.2.c, 185.2.a,
 * 350.2, 354) for the ability-free definitions, so the token half executes.
 * "to your base" still has no controller-relative spelling for a literal
 * effect.token `location` (a literal PlayerId must equal ctx.controller; only
 * a linked/known LocationRef works), so the printed destination is recorded
 * and exercised with the acting seat; the card also still lacks the RIFT-257
 * card-program trigger registration and the Deathknell body wiring (808.1.c
 * "When I die, get the effect.") that the keyword expansion owns.
 */
export default {
  canonicalCardId: "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「to your base」的目的地无法按契约直接书写：effect.token 的 location 只接受字面 " +
    "{ type: \"base\", player: <PlayerId> } 且必须等于 ctx.controller，静态 IR 没有相对控制者的 " +
    "LocationRef 记法（effect.move 有 controller-base，effect.token 没有；已知 LocationRef 只能经 " +
    "condition.value + linked-value 读取）。token 本体（Mech 定义 187.4、链上创建 + play 接手 " +
    "440.2.c/185.2.a）已合入并有执行测试；Deathknell 体还缺卡牌程序 → TriggerRegistration 的注册与 " +
    "trigger.leave 展开（808.1.c，RIFT-82 的 effects/keywords/Deathknell.ts 仍引用未注册的 trigger.leave），" +
    "属 RIFT-257。依赖：RIFT-82、RIFT-257、effect.token 的相对控制者 LocationRef（契约变更请求）。",
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
