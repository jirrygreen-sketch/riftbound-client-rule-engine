import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Trove Golem (sfd-174-221) — Unit, 8 energy + 2 Order power, Might 9, tag Freljord.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-174-221):
 *   When you play me, play four Gold gear tokens exhausted.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a): the card-played timing point
 *   filtered to this card.
 * - "play four Gold gear tokens" — a token that is *played* is first created on
 *   the Chain and then completed by the play procedure (440.2.c, 185.2.a, 350.2,
 *   354); 182/183 give each created token the ability controller as its
 *   controller/owner.
 * - "exhausted" is an entry stipulation (184.1, 185.2.d) for tokens whose
 *   default entry state would be ready.
 *
 * Status: judge-required — the token path is the same blocked boundary as the
 * merged Treasure Hoard (sfd-220-221) / Ferrous Forerunner (sfd-021-221), and
 * nothing is approximated:
 * - the Gold gear token definition (CR 187.5, a domainless gear token carrying
 *   its own printed "[Reaction][>] Kill this, [E]: [Add] [A]" ability) is
 *   deliberately absent from effect.token's frozen DEFINITIONS table, which
 *   documents that such definitions stay blocked/judge-required; running the
 *   merged primitive on "gold" returns negated with blockedReason
 *   "token-definition-or-abilities-judge-required".
 * - playing a NEW token requires chain creation plus the hand-off play; the
 *   frozen create-token action creates only on the Board and effect.token
 *   negates mode "play" with blockedReason "token-play-requires-chain-creation".
 * - the "exhausted" entry override is unsupported by the creation actions, and
 *   effect.exhaust's boundary notes that a later exhaust is not equivalent
 *   (143.4 / 184.1).
 * Dependencies: the Gold definition plus chain-create/entry-state work of the
 * token primitive task, and the chain play hand-off.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "trove-golem.play-gold-tokens",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 4 },
          // 440.2.c / 185.2.a: played tokens are created on the Chain first.
          mode: { kind: "constant", value: "play" },
          // Gear tokens are created/played at their controller's Base (440.2.b.1
          // for permanents; the effect names no other location).
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          // 184.1/185.2.d entry stipulation — never a later exhaust (143.4).
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "goldTokens" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-6e0d0c7e82324687174e1c1585a9fdba369a29e517e743eb601994ed2edb5de9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Gold gear token（CR 187.5，自带 “Kill this, [E]: [Add] [A]” 能力）不在 effect.token 的冻结定义表；该文件明确此类定义保持 " +
    "blocked/judge-required，对 “gold” 执行会得到 negated/blockedReason: token-definition-or-abilities-judge-required。" +
    "「play four … tokens」还必须按 440.2.c/185.2.a/350.2/354 先在链上创建再由 play 接手，冻结 create-token 只在场上创建、" +
    "mode \"play\" 被显式 negated（token-play-requires-chain-creation）；「exhausted」是入场规定（184.1/185.2.d），" +
    "create-token/play 不支持改写，事后 effect.exhaust 不等价（143.4）。不近似实现。依赖：Gold 定义与链上创建/入场状态（token 原语任务）、打出流程接线。",
  abilities,
  sourceText: "When you play me, play four Gold gear tokens exhausted."
} satisfies CardProgram;

export default program;
