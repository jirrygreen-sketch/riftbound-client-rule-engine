import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Trove Golem (sfd-174-221) — Unit, 8 energy + 2 Order power, Might 9, tag Freljord.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-174-221):
 *   When you play me, play four Gold gear tokens exhausted.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a): the card-played timing point
 *   filtered to this card through the contract 3.6 source anchor.
 * - "play four Gold gear tokens" — a token that is *played* is first created on
 *   the Chain and then completed by the play procedure (440.2.c, 185.2.a, 350.2,
 *   354); 182/183 give each created token the ability controller as its
 *   controller/owner.
 * - "exhausted" is an entry stipulation (184.1, 185.2.d) for tokens whose default
 *   entry state would be ready.
 *
 * Status: judge-required — two token-specific dependencies are still missing, and
 * nothing is approximated:
 * 1. the Gold gear token definition (CR 187.5: a domainless gear token carrying its
 *    own printed "[Reaction][>] Kill this, [E]: [Add] [A]" ability) is deliberately
 *    absent from effect.token's frozen DEFINITIONS table, which documents that such
 *    definitions stay blocked/judge-required. Running the merged primitive on
 *    "gold" returns negated with blockedReason
 *    "token-definition-or-abilities-judge-required".
 * 2. the "exhausted" entry override is unsupported by the creation/play actions;
 *    effect.exhaust's boundary notes that a later exhaust is not equivalent
 *    (143.4 / 184.1 / 185.2.d).
 * The chain-create + play handoff itself is merged: the golden proves the
 * card's own token/amount/mode/location shape against a merged definition really
 * creates and plays four tokens. The judged half stays on the Gold definition and
 * the entry state, so the printed "exhausted" entry is recorded as a
 * `test.todo` instead of being approximated by a later exhaust.
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
          // for permanents; the effect names no other location). The relative
          // selector is contract-valid, while effect.token still lacks its
          // runtime LocationExpr consumer.
          location: { kind: "location", value: "ability-controller-base" },
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
    "三处 token 依赖仍未合入（链上创建 + play 接手本身已合入）：" +
    "(1) Gold gear token 定义（CR 187.5：域外 gear token，自带印刷能力 “[Reaction][>] Kill this, [E]: [Add] [A]”）不在 effect.token 的冻结定义表；" +
    "该文件明确此类定义保持 blocked/judge-required，对 “gold” 执行会得到 negated + blockedReason: token-definition-or-abilities-judge-required。" +
    "(2)「exhausted」是入场状态规定（184.1/185.2.d），create-token/play 不支持改写；事后 effect.exhaust 不等价（143.4，effect.exhaust 文件头亦如此说明）。" +
    "已可真实执行：卡自身的 token/amount/mode/location 形状在已合入定义上会真实执行 create-token → play 四次" +
    "（golden 以此证明形状与 440.2.c 路径可用，且入场状态为默认 ready）；印刷的「exhausted」入场以 test.todo 记录，不按 ready 静默通过。" +
    "此外，effect.token 的参数解析器尚未消费 LocationExpr/relative selector " +
    "（`ability-controller-base`）并解析成运行时 LocationRef。不近似实现。",
  abilities,
  sourceText: "When you play me, play four Gold gear tokens exhausted."
} satisfies CardProgram;

export default program;
