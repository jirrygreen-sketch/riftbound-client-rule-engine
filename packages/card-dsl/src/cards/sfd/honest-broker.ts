import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Honest Broker (sfd-155-221) — Unit, 2 energy, Might 2, Order, tag Ionia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-155-221):
 *   [Deathknell] — Play a Gold gear token exhausted. (When I die, get the effect.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 808 / 808.1.c: [Deathknell] is a triggered-ability keyword that is
 *   functionally "When I die, [Effect]"; the death trigger is the
 *   object-killed timing point collected before the zone change (808.1.d,
 *   429.1.a.1.b). The keyword is declared as a KeywordAbility and the printed
 *   [Effect] body is authored explicitly, matching the merged Unsung Hero
 *   (sfd-167-221) shape.
 * - "Play a Gold gear token exhausted." — 440.2.c / 185.2.a: a token that is
 *   *played* is first created on the Chain and then completed by the play
 *   procedure (350.2, 354); 184.1 / 185.2.d allow the effect to state that the
 *   token enters exhausted although the default for its type is ready.
 * - Gold gear token = CR 187.5 (a domainless gear token that carries its own
 *   printed "[Reaction][>] Kill this, [E]: [Add] [A]" ability).
 *
 * Status: judge-required — the ability cannot be executed with merged code,
 * and nothing is approximated:
 * - the Gold definition is absent from effect.token's frozen DEFINITIONS table;
 *   that file documents that "definitions requiring other abilities, including
 *   Gold, remain blocked/judge-required" (187.5). Playing a NEW token requires
 *   chain creation plus the hand-off play (440.2.c, 185.2.a, 350.2, 354);
 *   the frozen create-token action creates only on the Board and effect.token
 *   negates mode "play" with blockedReason
 *   "token-play-requires-chain-creation".
 * - the "exhausted" entry is a creation/entry stipulation (184.1, 185.2.d),
 *   not a later exhaust: create-token/play support no entry override, and
 *   effect.exhaust's own boundary notes that add-on exhaustion would add a
 *   second "becomes exhausted" event and miss entry replacement (143.4).
 * - the [Deathknell] expansion body references the unmerged trigger.leave
 *   primitive (packages/engine-core/src/effects/keywords/Deathknell.ts), so the
 *   keyword's own instruction is not executable either; the card's explicit
 *   object-killed trigger does bind through the merged card-program binding
 *   (RIFT-257), but resolving its body hits the missing Gold definition first.
 * Dependencies: the Gold token definition plus the chain-creation/entry-state
 * work of the token primitive task, trigger.leave (RIFT-82 boundary), and the
 * cost-waived play handoff.
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "deathknell"
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true, cause: "kill", destination: "trash" }
    },
    optional: false,
    body: [
      {
        id: "honest-broker.play-gold-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a: a played token is created on the Chain first.
          mode: { kind: "constant", value: "play" },
          // Nominal gear-token destination; "exhausted" is the entry stipulation
          // below (184.1/185.2.d), never a later exhaust (143.4).
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          entersExhausted: { kind: "constant", value: true },
          linkKey: { kind: "constant", value: "goldToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-1289ecc082dc4dbd1ce937e07ccee8fcc9cd4f5f461b7043454560af9c237716",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Gold gear token（CR 187.5）不在 effect.token 的冻结定义表里——该文件明确 Gold 等自带能力的定义保持 " +
    "blocked/judge-required；「Play a Gold gear token」还要求按 440.2.c/185.2.a/350.2/354 先在链上创建再接手打出，" +
    "effect.token 的 mode \"play\" 已合入（链上创建 + play 接手，RIFT-257 后的 goldens 已用该路径执行），" +
    "但 Gold 定义缺失使创建直接以 blockedReason: token-definition-or-abilities-judge-required negated。" +
    "「exhausted」是入场规定（184.1/185.2.d），create-token/play 不支持入场状态改写；" +
    "effect.exhaust 文档明确事后横置不等价（会多一次「成为横置」事件并错过 143.4 的入场处理），故不近似。" +
    "[Deathknell] 展开体引用的 trigger.leave 原语未合入（effects/keywords/Deathknell.ts 只声明 op id）；" +
    "已合入部分：本卡显式声明的 object-killed 触发与 [Deathknell] 关键词展开都能经卡牌程序绑定" +
    "（RIFT-257）注册（golden 断言注册成功），阻止执行的是 Gold 定义与入场状态。" +
    "依赖：Gold token 定义与入场状态（token primitive 任务/RIFT-62 后续）、RIFT-82（kw-deathknell 的 trigger.leave）。",
  abilities,
  sourceText: "[Deathknell] — Play a Gold gear token exhausted. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
