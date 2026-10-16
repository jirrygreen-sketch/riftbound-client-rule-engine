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
 * "Play two 3 [M] Mech unit tokens to your base" would create the 3-Might
 * Mech token (CR v1.5 187.4) at the controller's base. The frozen
 * create-token GameAction only creates tokens on the Board (440.2); playing
 * a NEW token must first create it on the Chain (440.2.c, 185.2.a), which
 * the closed action set does not provide. effect.token therefore negates
 * mode "play" (blockedReason token-play-requires-chain-creation), so this
 * card stays judge-required until on-chain token creation lands.
 */
export default {
  canonicalCardId: "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Play two 3 [M] Mech unit tokens to your base」要求按 CR v1.5 440.2.c / 185.2.a 在链上创建待打出的 token；" +
    "封闭 GameAction create-token 只支持在场上直接创建，effect.token 的 mode \"play\" 被显式阻断" +
    "（blockedReason: token-play-requires-chain-creation），缺少链上创建 token 的原语 / 契约支持。" +
    "依赖：RIFT-82（kw-deathknell-legion，Deathknell 关键词展开）。",
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
