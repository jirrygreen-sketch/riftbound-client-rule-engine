import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Undertitan (sfd-175-221) — Unit, 6 energy + 1 Order power, Might 5, tag The Void.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-175-221):
 *   When you play me, give your other units +2 :rb_might: this turn.
 *   As I'm revealed from your deck, [Add] :rb_energy_2:.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" is a Play Effect (383.4.a): the card-played timing point
 *   filtered to this card. "your other units" is a set selection by
 *   characteristics — "each"/"all" effects are not targets (355.10.d) — so the
 *   body carries no TargetSpec and excludes the source itself (355.9.c).
 * - "give ... +2 :rb_might: this turn" is a temporary Might modification that
 *   expires at end of turn; Might is altered in the arithmetic layer (143.2.a,
 *   475–477), and the duration is a continuous-effect lifetime, not a Buff
 *   (702 Buffs are counters; effect.buff's own header states temporary Might
 *   changes "belong to continuous.might, never to this primitive").
 * - "As I'm revealed from your deck" is not an instruction: 135.2.b.6 uses this
 *   exact text as its example of a replacement clause, and 369.1 / 2334-2388
 *   name Undertitan as the example of a Replacement Effect that alters a reveal
 *   from the deck. "[Add] :rb_energy_2:" adds 2 Energy to the controller's Rune
 *   Pool (430.1, 166.1).
 *
 * Status: judge-required — both halves have concrete merged gaps:
 * - the temporary Might grant needs a consumable continuous.might effect; the
 *   layers engine (RIFT-91) exists, but no instruction primitive registers
 *   one, no merged consumer reads the amount of a card-program static effect,
 *   and "this turn" expiry has no wired duration task — the same
 *   judge-required position already recorded by the merged Dangerous Duo
 *   (ogn-016-298) and Frigid Touch (sfd-066-221).
 * - the reveal replacement has no registration path: the event pipeline
 *   registers replacements as action matchers and nothing turns a card
 *   program's ReplacementAbility into one, the replaced "reveal" event is not
 *   one of the frozen GameActions observable that way, and there is no added
 *   replacement-event binding for card programs (engine batch 4).
 * The golden test executes the merged effect.resources primitive ([Add] 2
 * Energy, 430.1) against the reference kernel; the Might and replacement halves
 * stay TODO with their task numbers.
 * Dependencies: RIFT-91 follow-up (continuous.might primitive + end-of-turn
 * duration + card-program registration), engine batch 4/5 (card replacement
 * registration), plus an observable "revealed from deck" event.
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
        id: "undertitan.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          // 355.10.d: "your other units" is a set selected by characteristics,
          // not a target choice; "other" excludes the source unit (355.9.c).
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: {
                zone: "board",
                type: "unit",
                controller: "controller",
                other: true
              }
            }
          }
        }
      }
    ]
  },
  {
    // "As I'm revealed from your deck, [Add] :rb_energy_2:." — the leading
    // clause is not an instruction (135.2.b.6) but a Replacement Effect over
    // the reveal (369.1); the replacement body is the merged Add of 2 Energy
    // (430.1). The replaced-event binding/registration is the judged part.
    kind: "replacement",
    replaces: {
      event: "card-revealed",
      filter: { source: "self", zone: "deck" }
    },
    with: [
      {
        id: "undertitan.add-energy-2",
        op: "effect.resources",
        args: {
          energy: { kind: "constant", value: 2 },
          linkKey: { kind: "constant", value: "resources" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-722d071685a6b301064e318e0f8ac8683e616a934d89658bf00fb0fedca48f5a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1)「give your other units +2 :rb_might: this turn」需要可消费的 continuous.might 持续效果——" +
    "契约 3.6 封闭 GameAction 无 Might 修改动作，effect.buff 明确临时 Might 修改属 continuous.might 而不属本原语；" +
    "已合入的图层（RIFT-91）没有注册入口、没有读取卡牌 static 效果 amount 的消费者，「this turn」到期也没有接线" +
    "（与已合入的 Dangerous Duo ogn-016-298 / Frigid Touch sfd-066-221 同一 judge-required 口径）。" +
    "(2)「As I'm revealed from your deck, [Add] :rb_energy_2:」是替代效果（135.2.b.6 以本句为例；369.1/CR 2334 引 Undertitan 为" +
    "“替代一次揭示”的例子）：事件管线（RIFT-120）只以动作匹配器注册替代、且揭示不是可从该处观察的封闭 GameAction，" +
    "没有卡牌程序→替代注册的接线。with 体本身是已合入的 effect.resources（430.1 加 2 能量），golden 真实执行该半段。" +
    "依赖：RIFT-91 后续（continuous.might 原语 + end-of-turn 期限 + 卡牌注册）、引擎批 4/5（替代注册）、可观察的“从牌库被揭示”事件。",
  abilities,
  sourceText:
    "When you play me, give your other units +2 :rb_might: this turn.\n" +
    "As I'm revealed from your deck, [Add] :rb_energy_2:."
} satisfies CardProgram;

export default program;
