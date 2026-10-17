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
 * Rules reading (CR v1.5):
 * - "Reveal the top card of your Main Deck" is `effect.reveal` over an ordered
 *   pick: RIFT-358 merged PickSpec.zoneSlice, which locks the real deck-top
 *   reference at Finalize and hands it to effect.reveal as a non-target pick.
 *   The instruction never reads card order from ctx.query.
 * - "Choose an opponent. They guess a card type. … If it has that type" needs a
 *   private/declarative guess made by another player plus a comparison against
 *   the revealed card's type. The survey (docs/plans/survey/unclassified-rad-sfd.md,
 *   section 25) records this as the new primitive `choice.hidden-guess`
 *   (CR 128.3, 425, 135.2.b.7). The merged Condition/Expr vocabulary has no
 *   guessing primitive and no link-value producer for it.
 * - The card-type mismatch is reported, not fixed: the catalog types this
 *   printing as `Spell`, while its rules text is an Activated Ability with
 *   [Energy 1], [Exhaust] as the cost (CR v1.5 145.1 Units / 151.1 Gear;
 *   159.2 lists only Action and Reaction as a spell's non-executable keywords).
 *
 * Status: judge-required, re-reviewed 2026-10-17. RIFT-358 closed the ordered
 * deck-top half: the reveal step declares `picks` with
 * `zoneSlice: { zone: "deck", from: "top", count: 1 }` and the chain adapter
 * locks the actual deck-top reference at Finalize (production execution
 * evidence in the golden test). The remaining gap is still
 * `choice.hidden-guess`: no merged primitive lets another player declare a
 * private card-type guess, and no link-value producer feeds that guess to the
 * compare/in membership test, so both branches remain fail-closed without a
 * written guess.
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
    "“Reveal the top card of your Main Deck”已由 PickSpec.zoneSlice 在 Finalize 锁定真实牌库顶引用并交给 effect.reveal（golden 已真实执行该步；" +
    "不再依赖 effect.reveal 的 ctx.query 顺序）。" +
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
          // "Reveal the top card of your Main Deck." — one card from the real
          // top of the controller's own Main Deck. The ordered pick locks the
          // deck-top reference at Finalize (RIFT-358 PickSpec.zoneSlice) and
          // effect.reveal consumes it as a non-target pick; the link key
          // "revealed" is effect.reveal's own merged contract.
          id: "scrutinizing-scope.reveal-top",
          op: "effect.reveal",
          args: {
            pick: { kind: "constant", value: "scrutinizing-scope.deck-top" }
          },
          picks: [
            {
              id: "scrutinizing-scope.deck-top",
              options: [],
              ordered: true,
              zoneSlice: {
                zone: "deck",
                from: "top",
                count: { kind: "constant", value: 1 }
              },
              selection: "all"
            }
          ]
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
