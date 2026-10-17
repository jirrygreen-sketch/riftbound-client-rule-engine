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
 *   The membership test ("has that type") is the merged compare with the `in`
 *   operator: the interpreter's compareValues implements left-in-right, and the
 *   revealed card's `types` array is read through object-property on the
 *   reveal's link value (see the two branches below).
 *
 * Status: judge-required, re-reviewed against the merged M2 batches. The
 * deck-top half moved: effect.reveal still reads ctx.query (which does not
 * guarantee zone order) and requires an *upstream* ordered pick for a subset of
 * a non-hand zone, so the ordered supply is still the caller's job; the
 * interpreter and the kernel do provide zoneSlice for ordered reads
 * (effects/testing/README: 读牌库顶 N 张必须用 zoneSlice), but no merged
 * producer turns the deck top into refs for effect.reveal, so the reveal step
 * stays unavailable in IR.
 * The remaining gaps are unchanged in kind but now stated precisely:
 * - "Choose an opponent. They guess a card type" needs choice.hidden-guess:
 *   a private/declarative guess made by another player plus a comparison
 *   against the revealed card's type (CR 128.3, 425, 135.2.b.7); the merged
 *   Condition/Expr vocabulary has no guessing primitive and no link-value
 *   producer for it;
 * - "If it has that type" IS expressible with the merged evaluator: the
 *   interpreter's compareValues implements "in" as left-in-right, so a scalar
 *   guessed type can be tested against the revealed card's types array read
 *   through object-property on the reveal's link value. The branches below use
 *   that form. What is still missing is the producer of the guessed-type link;
 *   with no guess written, the condition's linked read has no value and the
 *   branch is ignored (fail-closed) rather than guessing;
 * - the printing's card-type mismatch (reported, not fixed here).
 */
export default {
  canonicalCardId: "card.hash-b08afbe6dc630f67287c7ab652b90f17c81abfd9d7f94bda47eae324899ce111",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺原语 choice.hidden-guess（指定对手在私密信息约束下声明一个卡类猜测，并把它与公开揭示对象的类型比较）：" +
    "CR 1.5 128.3 / 425 / 135.2.b.7，见 docs/plans/survey/unclassified-rad-sfd.md 第 25 条。" +
    "“类型数组包含”本身已可表达（解释器的 compareValues 把 in 实现为左值属于右数组，右值可用 object-property 读揭示牌的 types），" +
    "但猜测值没有任何生产者：没有 guess 链接值时条件读不到值、分支 fail-closed（两条分支因此各自带该 condition，非玩家选择，故不写 choice.mode）。" +
    "“Reveal the top card of your Main Deck”的牌库顶顺序必须由 zoneSlice 或上游有序 pick 提供（RIFT-66 的 zoneSlice 已合入），" +
    "effect.reveal 自身的 ctx.query 不保证区域内顺序，对非手牌区域的子集明确要求上游有序 pick，" +
    "而没有已合入的提供者把牌库顶解析成这些引用。" +
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
          // reference must come from the ordered deck top (the merged zoneSlice
          // provides the ordered read, but no merged producer hands effect.reveal
          // the deck-top refs); the link key "revealed" is
          // effect.reveal's own merged contract.
          id: "scrutinizing-scope.reveal-top",
          op: "effect.reveal",
          args: {
            zone: { kind: "constant", value: "deck" },
            count: { kind: "constant", value: 1 }
          }
        },
        {
          // "If it has that type, recycle it." — the merged membership test:
          // the scalar guessed type is tested with compare/in against the
          // revealed card's types array (interpreter compareValues =
          // left-in-right). The instruction is not wrapped in a player choice.
          // The guess link has no producer yet (see judgeReason), so without a
          // written guess the linked read has no value and the branch is
          // ignored rather than opening a made-up gate.
          id: "scrutinizing-scope.recycle-if-matched",
          op: "effect.recycle",
          linkedTo: "scrutinizing-scope.reveal-top",
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "scrutinizing-scope.guess-type",
              key: "guessedType"
            },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "scrutinizing-scope.reveal-top" },
              property: "types"
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
              kind: "compare",
              left: {
                kind: "linked-value",
                instructionId: "scrutinizing-scope.guess-type",
                key: "guessedType"
              },
              operator: "in",
              right: {
                kind: "object-property",
                object: { linked: "scrutinizing-scope.reveal-top" },
                property: "types"
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
