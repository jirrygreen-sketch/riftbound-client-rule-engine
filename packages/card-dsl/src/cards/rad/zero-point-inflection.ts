import type { CardProgram } from "../../ir/index.js";

/**
 * rad-069-167 Zero Point Inflection (Spell, 9 energy + 2 power, Mind).
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json,
 * dataVersion 2026-10-12-official-gallery, printing rad-069-167):
 * energy 9, power 2, might null, domains ["Mind"], tags [].
 *
 * Printed text (verbatim, sourceText):
 *   "When you play a card, draw 2.
 *    When you draw 1 or more cards with 9 or more other cards in your hand,
 *    discard your hand, kill this, and choose an opponent. They score 1 point."
 *
 * Card-type data problem (reported, not fixed here): the catalog types this
 * printing as `Spell`, but the text is a permanent that stays on the board and
 * is later killed by its own triggered ability ("kill this"), with two ongoing
 * triggers. A spell resolves and is placed in the Trash (CR v1.5 157 / 351.2),
 * so "kill this" and an ongoing "When you play a card" trigger cannot apply to
 * a spell card. rad-046-167, rad-064-167 and rad-072-167 have the same
 * mismatch. The real card type is not invented here; the mismatch is reported.
 *
 * Rules reading (CR v1.5):
 * - "When you play a card, draw 2" is a Triggered Ability on the card-played
 *   timing point. It is not a Play Effect (383.4.a.4: abilities that trigger
 *   when another object is played are not Play Effects). Body: draw 2 (414).
 * - "When you draw 1 or more cards with 9 or more other cards in your hand" is
 *   a second Triggered Ability on the card-drawn timing point, gated on the
 *   controller's hand size, where "other" excludes the card(s) just drawn.
 * - Its effect discards the whole hand (423.1/423.5), kills the source
 *   ("kill this", 429.6's self form), and then chooses an opponent who scores
 *   1 point (194.1.c, 470).
 *
 * Status: judge-required. Trigger registration attaches the authored
 * condition to the registration (programs/triggers.ts), and the pipeline really
 * evaluates it per draw event with MissingInformation retry
 * (events/pipeline.ts evaluateTriggerCondition). The gate is still
 * unexecutable because the condition cannot reference the draw event itself:
 * - the IR Expr union has no event-object / event-batch expression, so neither
 *   the per-card event object nor the original draw action's batch amount is
 *   reachable from the condition (the CountExpr `subject` string is ignored
 *   by the evaluator; count uses only `filter`);
 * - the existing count expression can query the post-draw hand, but its
 *   `exclude` anchor resolves only through ObjectSelector — the program source,
 *   not the card(s) drawn by this event — so it cannot express "other" for a
 *   multi-card draw;
 * - per-card card-drawn emissions (action-adapter.ts, one per drawn object,
 *   amount 1, shared simultaneousGroup) are each fully scanned (pipeline
 *   publish() drains each group before scanning the next), so even an
 *   expressible hand-size condition would re-fire the whole trigger body on
 *   intermediate hand states inside one draw action.
 * The discard / kill / score half uses only merged primitives (effect.discard
 * with "all", effect.kill with self: true, effect.score) and is executed by the
 * golden test.
 */
export default {
  canonicalCardId: "card.hash-8947b1c8eec76f1d8d4743f57a95e59af4015eec80d3c6b3ba999b7ad2611d3d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-18 复核：触发注册已把 condition 附到 registration（programs/triggers.ts），" +
    "pipeline 也对每次抽牌事件真实求值该条件（events/pipeline.ts 的 evaluateTriggerCondition，含 MissingInformation 重试）；" +
    "缺的是“本次抽牌后手牌中其他牌数 ≥ 9”的事件引用：" +
    "(1) IR 的 Expr 联合类型没有 event-object / event-batch 表达式，条件既引用不到每张牌的" +
    "card-drawn 事件对象，也引用不到原始 draw action 的批次 amount（CountExpr 的 subject 字段" +
    "被求值器忽略，count 只使用 filter）；" +
    "(2) 现有 count 表达式可以查询抽牌提交后的手牌，但 count 的 exclude 锚点只能解析为" +
    "ObjectSelector（卡牌程序来源对象），不是本次 draw 事件抽到的牌，因而无法在多张抽牌时表达“other”。" +
    "(3) 抽多张牌时 action-adapter 为每张牌各发一个 card-drawn 事件（amount 1、共享 simultaneousGroup），" +
    "而 pipeline 的 publish 会先完整扫完前一组再发下一组——即使条件可表达，也会在同一 draw action 的" +
    "中间手牌状态下把整个触发体重复执行。" +
    "另有卡牌数据问题：目录把该印刷标为 Spell，但文本是留在场上、随后被自身触发“kill this”的永久物（两个持续触发）；" +
    "Spell 结算后进弃牌堆（CR 1.5 157/351.2），“kill this”与持续触发都不成立，本任务不改数据、不推断真实卡型。" +
    "“discard your hand / kill this / They score 1 point”三半段用已合入原语表达，并有真实执行证据。",
  abilities: [
    {
      // "When you play a card, draw 2." — mandatory trigger on another card
      // being played (383.4.a.4), body is a plain draw 2 (414.3).
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "zero-point-inflection.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    },
    {
      // "When you draw 1 or more cards with 9 or more other cards in your hand,
      // discard your hand, kill this, and choose an opponent. They score 1
      // point." The gate is the unmerged hand-size condition (judgeReason).
      kind: "triggered",
      trigger: {
        at: "card-drawn",
        filter: { event: "card-drawn", player: "controller" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "other-cards-in-hand-after-this-draw",
            filter: { zone: "hand", owner: "controller", exclude: "source" }
          },
          operator: "gte",
          right: { kind: "constant", value: 9 }
        }
      },
      optional: false,
      body: [
        {
          // "discard your hand" — the whole hand of the ability controller
          // (423.1/423.5 "Discard your hand").
          id: "zero-point-inflection.discard-hand",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: "all" } }
        },
        {
          // "kill this" — self-kill (429.6 self form); the discard is a
          // separate instruction, so it still happens if the kill is replaced
          // (359.3.e.14.b).
          id: "zero-point-inflection.kill-self",
          op: "effect.kill",
          linkedTo: "zero-point-inflection.discard-hand",
          args: {
            self: { kind: "constant", value: true },
            reason: { kind: "constant", value: "rad-069-167 zero-point-inflection" }
          }
        },
        {
          // "choose an opponent. They score 1 point." — the opponent is a
          // player pick (355.10.f: an instruction a player must complete does
          // not target), and that player gains 1 point (194.1.c, 470).
          id: "zero-point-inflection.score",
          op: "effect.score",
          linkedTo: "zero-point-inflection.kill-self",
          args: {
            amount: { kind: "constant", value: 1 },
            // effect.score's player selector form: { kind: "pick", id } reads
            // the selected opponent from the PickSpec below (its documented
            // non-target player selection path).
            player: {
              kind: "constant",
              value: { kind: "pick", id: "chosen-opponent" }
            }
          },
          picks: [
            {
              id: "chosen-opponent",
              options: ["opponent"],
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
    "When you play a card, draw 2.\n" +
    "When you draw 1 or more cards with 9 or more other cards in your hand, " +
    "discard your hand, kill this, and choose an opponent. They score 1 point."
} satisfies CardProgram;
