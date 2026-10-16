import type { CardProgram } from "../../ir/index.js";

/**
 * rad-064-167 Scrutinizing Scope (Spell, 2 energy, Mind).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-064-167):
 * energy 2, power null, might null, domains ["Mind"], tags [].
 * `power: null` means there is no printed power; the cost declares energy only
 * and never rewrites the missing power as 0 (cards README section 2).
 *
 * Printed text (verbatim, sourceText):
 *   ":rb_energy_1:, :rb_exhaust:: Choose an opponent. They guess a card type.
 *    Reveal the top card of your Main Deck. If it has that type, recycle it.
 *    Otherwise, draw it. (Unit, gear, and spell are types.)"
 *
 * Card-type data problem (reported, not fixed here): the catalog types this
 * printing as `Spell`, while its rules text is an Activated Ability of a
 * permanent (a "[E], [Exhaust]:" cost; CR v1.5 145.1 Units / 151.1 Gear, and
 * 159.2 lists only Action and Reaction as a spell's non-executable keywords).
 * A spell has no Exhaust symbol in its cost and no ongoing activated ability
 * once it resolves (157: it is placed in the Trash). rad-046-167 Resplendent
 * Rostrum, rad-069-167 Zero Point Inflection and rad-072-167 Overloaded
 * Traveler carry the same mismatch. The real card type is not invented here.
 *
 * Rules reading (CR v1.5):
 * - "Choose an opponent. They guess a card type" needs a private/declarative
 *   guess made by another player plus a comparison against the revealed card's
 *   type. The survey (docs/plans/survey/unclassified-rad-sfd.md, section 25)
 *   records this as the new primitive `choice.hidden-guess` (CR 128.3, 425,
 *   135.2.b.7), covering both the opponent designation and the guess.
 * - "Reveal the top card of your Main Deck" is `effect.reveal` over the deck
 *   top; the ordered reference must come from `zoneSlice` or an upstream
 *   ordered pick (interpreter README: query() does not guarantee zone order),
 *   which is unmerged upstream work this program cannot state.
 * - "If it has that type, recycle it. Otherwise, draw it" is NOT a player
 *   choice: the branch is decided by whether the revealed card has the guessed
 *   type (contract 3.4: a condition clause scopes exactly the instruction that
 *   carries it). Both instructions therefore carry their own condition and the
 *   card declares no `choice.mode` — nothing here asks a player to pick a
 *   mode, and modelling it as one would invent a choice the text does not give.
 *   The membership test itself ("has that type") is unmerged as well: Condition
 *   has no array-contains operator and `in` tests left-in-right, so a card's
 *   `types` array cannot be tested for one type (the same gap recorded for
 *   sfd-215-221 Ravenbloom Conservatory).
 *
 * Status: judge-required (missing `choice.hidden-guess`; missing ordered
 * deck-top supply for effect.reveal; no array-contains condition; and the
 * printing's card-type mismatch).
 */
export default {
  canonicalCardId: "card.hash-b08afbe6dc630f67287c7ab652b90f17c81abfd9d7f94bda47eae324899ce111",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺原语 choice.hidden-guess（指定对手在私密信息约束下声明一个卡类猜测，并把它与公开揭示对象的类型比较）：" +
    "CR 1.5 128.3 / 425 / 135.2.b.7，见 docs/plans/survey/unclassified-rad-sfd.md 第 25 条。" +
    "同时缺“类型数组包含”的条件表达：Condition 只有 eq/ne/lt/lte/gt/gte/in，且 in 是左值属于右数组，" +
    "无法测试揭示牌的 types 是否含该猜测类型（与 sfd-215-221 Ravenbloom Conservatory 记录同一缺口）；" +
    "因此两条分支各自带描述性 condition（非玩家选择，故不写 choice.mode）。" +
    "“Reveal the top card of your Main Deck”的牌库顶顺序必须由 zoneSlice 或上游有序 pick 提供，" +
    "effect.reveal 自身的 ctx.query 不保证区域内顺序（RIFT-66 之后的上游有序查询接线未合入）。依赖 RIFT-89/90。" +
    "另有卡牌数据问题：该印刷被目录标为 Spell，但文本是永久物的启动式能力（[E],[Exhaust] 费用，CR 1.5 145.1/151.1；" +
    "Spell 结算后进弃牌堆，157）；本任务不改数据、不推断其真实卡型。不近似实现。",
  abilities: [
    {
      // The ability exactly as printed (1 energy plus exhausting the source).
      // Whether such an ability can exist depends on the printing's real card
      // type (see the data problem above); the printed shape is declared as-is.
      kind: "activated",
      cost: {
        // "activated" is the CostSpec kind the merged cost plan reads for an
        // activated ability (cost-plan.ts readCost).
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          // "Choose an opponent. They guess a card type." — one primitive:
          // designate an opponent and let them declare a card type privately
          // (chooser-only). Not registered yet (judgeReason).
          id: "scrutinizing-scope.guess-type",
          op: "choice.hidden-guess",
          args: {
            guesser: { kind: "constant", value: { selector: "opponent", count: 1 } },
            options: { kind: "constant", value: ["unit", "gear", "spell"] },
            visibility: { kind: "constant", value: "chooser-only" },
            linkKey: { kind: "constant", value: "guessedType" }
          }
        },
        {
          // "Reveal the top card of your Main Deck." — one card from the top of
          // the controller's own Main Deck. No player argument: the revealing
          // player defaults to ctx.controller, which is what "your Main Deck"
          // means (a literal "controller" string is not a PlayerId). The
          // reference must come from the ordered deck top (RIFT-66 upstream
          // ordered query, unmerged); the link key "revealed" is
          // effect.reveal's own merged contract.
          id: "scrutinizing-scope.reveal-top",
          op: "effect.reveal",
          args: {
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 1 }
          }
        },
        {
          // "If it has that type, recycle it." — gated on the guess comparison,
          // which is descriptive data here (see judgeReason). The instruction
          // is not wrapped in a player choice.
          id: "scrutinizing-scope.recycle-if-matched",
          op: "effect.recycle",
          linkedTo: "scrutinizing-scope.reveal-top",
          condition: {
            kind: "expression",
            value: {
              kind: "constant",
              value: {
                guessComparison: "revealed-card-has-guessed-type",
                guessedType: { linked: "guessedType" },
                revealed: { linked: "revealed" }
              }
            }
          },
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "scrutinizing-scope.reveal-top",
              key: "revealed"
            }
          }
        },
        {
          // "Otherwise, draw it." — the negation of the same comparison, so the
          // two branches are mutually exclusive without a player choice. The
          // revealed card is moved into hand as a non-target pick (355.10.c/e);
          // the pick's options come from the reveal's own link value.
          id: "scrutinizing-scope.draw-if-other",
          op: "effect.zone",
          linkedTo: "scrutinizing-scope.reveal-top",
          condition: {
            kind: "not",
            condition: {
              kind: "expression",
              value: {
                kind: "constant",
                value: {
                  guessComparison: "revealed-card-has-guessed-type",
                  guessedType: { linked: "guessedType" },
                  revealed: { linked: "revealed" }
                }
              }
            }
          },
          args: {
            pick: { kind: "constant", value: "revealed-card" },
            to: { kind: "constant", value: "hand" }
          },
          picks: [
            {
              id: "revealed-card",
              options: [
                {
                  kind: "linked-value",
                  instructionId: "scrutinizing-scope.reveal-top",
                  key: "revealed"
                }
              ],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Choose an opponent. They guess a card type. " +
    "Reveal the top card of your Main Deck. If it has that type, recycle it. " +
    "Otherwise, draw it. (Unit, gear, and spell are types.)"
} satisfies CardProgram;
