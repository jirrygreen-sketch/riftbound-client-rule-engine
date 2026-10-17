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
 * Status: judge-required. The ability cannot be executed with merged code,
 * and nothing is approximated:
 * - the Gold definition is absent from effect.token's frozen DEFINITIONS table;
 *   that file documents that "definitions requiring other abilities, including
 *   Gold, remain blocked/judge-required" (187.5). Playing a NEW token requires
 *   chain creation plus the hand-off play (440.2.c, 185.2.a, 350.2, 354);
 *   the merged play mode really does the chain-creation handoff (the golden
 *   drives a definition the frozen table has), and the missing Gold definition
 *   negates the same instruction with blockedReason
 *   "token-definition-or-abilities-judge-required".
 * - the "exhausted" entry is a creation/entry stipulation (184.1, 185.2.d),
 *   not a later exhaust: create-token/play support no entry override —
 *   effect.token's argument schema rejects the authored `entersExhausted`
 *   outright ("Invalid effect.token argument") — and effect.exhaust's own
 *   boundary notes that add-on exhaustion would add a second "becomes
 *   exhausted" event and miss entry replacement (143.4).
 * - the [Deathknell] expansion body references the unmerged trigger.leave
 *   primitive (packages/engine-core/src/effects/keywords/Deathknell.ts), so the
 *   keyword's own instruction is not executable either; the card's explicit
 *   object-killed trigger does bind through the merged card-program binding,
 *   but resolving its body hits the missing Gold definition first.
 * Dependencies: the Gold token definition plus the chain-creation/entry-state
 * work of the token primitive task, trigger.leave, and the cost-waived play
 * handoff.
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
        // 359.2.d: a Non-Unit Gear enters the Board at the player's Base, so the
        // destination is the ability controller's Base (not a choice). The
        // merged location provider resolves the relative base into a concrete
        // LocationRef for the linked token instruction (the merged
        // sfd/deserts-call and sfd/guards shape).
        id: "honest-broker.choose-location",
        op: "condition.value",
        locations: [
          {
            id: "honest-broker.token-location",
            type: "base",
            player: "controller",
            min: 1,
            max: 1,
            selection: "one"
          }
        ],
        args: {
          value: {
            kind: "location",
            value: { kind: "target-location", target: "honest-broker.token-location" }
          },
          key: { kind: "constant", value: "location" }
        }
      },
      {
        id: "honest-broker.play-gold-token",
        op: "effect.token",
        linkedTo: "honest-broker.choose-location",
        args: {
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a: a played token is created on the Chain first.
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "linked-value",
            instructionId: "honest-broker.choose-location",
            key: "location"
          },
          // The printed "exhausted" is a creation/entry stipulation (184.1 /
          // 185.2.d), never a later exhaust (143.4). No merged token path carries
          // an entry override, so the reviewed record keeps the stipulation named
          // here and the primitive fails closed on it ("Invalid effect.token
          // argument") instead of a silent entry as ready.
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
    "effect.token 的 mode \"play\" 已合入（链上创建 + play 接手，golden 用本卡自己的指令形状以表中已有的定义执行该路径），" +
    "但 Gold 定义缺失使创建直接以 blockedReason: token-definition-or-abilities-judge-required negated。" +
    "「exhausted」是入场规定（184.1/185.2.d），create-token/play 不支持入场状态改写：effect.token 的参数 schema " +
    "直接以 \"Invalid effect.token argument: entersExhausted\" 拒绝手工加的入场覆盖字段；" +
    "effect.exhaust 文档明确事后横置不等价（会多一次「成为横置」事件并错过 143.4 的入场处理），故不近似。" +
    "[Deathknell] 展开体引用的 trigger.leave 原语仍未注册（effects/keywords/Deathknell.ts 只声明 op id）；" +
    "已合入部分：本卡显式声明的 object-killed 触发与 [Deathknell] 关键词展开都能经卡牌程序绑定注册" +
    "（golden 用真实 EventPipeline 断言注册成功），阻止执行的是 Gold 定义与入场状态。" +
    "依赖：Gold token 定义（含其内建 [Reaction][>] 能力）与入场状态改写、trigger.leave 原语。",
  abilities,
  sourceText: "[Deathknell] — Play a Gold gear token exhausted. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
