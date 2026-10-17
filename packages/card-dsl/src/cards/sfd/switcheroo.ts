import type { CardProgram } from "../../ir/index.js";

/**
 * Switcheroo (sfd-145-221) — Spell, 2 energy + 2 Chaos power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-145-221, verbatim):
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *    :rb_energy_0:.)
 *    [Action] (Play on your turn or in showdowns.)
 *    Swap the Might of two units at the same battlefield this turn."
 *
 * Rules evidence (Core Rules v1.5):
 * - "[Hidden]" (811) and "[Action]" (806) are declared only (contract 3.7):
 *   Hidden expands to the cost.hidden static effect,
 *   Action to continuous.timing; the Hide discretionary action (422) and the
 *   Showdown admission belong to the cost/timing/chain modules.
 * - "two units at the same battlefield" is one target group of exactly two
 *   units: 355.9.b allows the location restriction, and "at the same
 *   battlefield" is the paired constraint expressed with the merged
 *   sameLocationAs anchor (the second unit shares the first target's Location)
 *   plus exclude so one unit cannot fill both slots (355.9.b, the same shape
 *   merged ogn/defiant-dance and ogn/en-garde use). The printed count is fixed,
 *   so the bounds are min 2 / max 2, not "up to" (355.13).
 * - "Swap the Might of two units ... this turn" is the atomic exchange the
 *   survey records as the missing primitive effect.swap-might
 *   (docs/plans/survey/unclassified-rad-sfd.md, sfd-145-221): both units' current
 *   Might values must be read together and exchanged, and the result lasts until
 *   the end of the turn (317.2.c). The merged continuous.might effect can only
 *   apply an amount; two independent modifications cannot express the exchange
 *   when the units' Might values differ or change, and 303.1 requires game
 *   actions to be performed one at a time, so reading and writing in two
 *   instructions is observable and wrong. effect.buff is explicitly not a Might
 *   modification (703), so no substitute is authored.
 *
 * Status (cards/README.md §2): judge-required. The printed target group is
 * retained, but the atomic `effect.swap-might` operation is not in the merged
 * instruction vocabulary. The second target's same-battlefield relation also
 * needs a production target-location selector; the local selector can evaluate
 * it, while program target translation still rejects the dynamic anchor. The
 * Hidden permission remains a separate unresolved `cost.hidden` consumer.
 */
const switcheroo = {
  canonicalCardId: "card.hash-bc97ea8be41594b9d618dfc49882dc35b7da2291b707b6e49958c26e4ad49d0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前仍缺三个真实消费方：(1) 原子交换两个单位当前 Might 并在本回合持续的 effect.swap-might 指令；" +
    "continuous.might 不能把两个目标的读数绑定成一次交换，不能用两条独立写入近似。(2) 第二个目标的 " +
    "sameLocationAs 动态位置关系可由本地 selector 求值，但生产 target translator 还没有把该位置选择器接到 Finalize。" +
    "(3) [Hidden] 的 cost.hidden 仍没有 Hide/facedown 区域与重放许可消费方。[Action] 时机与卡牌程序绑定已合入，" +
    "故不再把它们列为缺口。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷基础费用 2 Energy + 2 Chaos Power（356.1.c 由卡牌身份在 Finalize 绑定）。
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // 「Swap the Might of two units at the same battlefield this turn」：
          // 原子交换（effect.swap-might 当前不可用，见 judgeReason）。
          id: "switcheroo.swap-might",
          op: "effect.swap-might",
          args: {
            duration: { kind: "constant", value: "this-turn" },
            // 两个目标身份必须各自保留（不能降级为两个独立设值）。
            targets: {
              kind: "constant",
              value: [
                { target: "switcheroo.first-unit" },
                { target: "switcheroo.second-unit" }
              ]
            }
          },
          targets: [
            {
              id: "switcheroo.first-unit",
              // 第一个单位：战场上的任一单位（不限控制者）。
              filter: { type: "unit", zone: "board", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "switcheroo.second-unit",
              // 与第一个同一战场（sameLocationAs），且不能是同一个单位（exclude）。
              filter: {
                type: "unit",
                zone: "board",
                sameLocationAs: { target: "switcheroo.first-unit" },
                exclude: { target: "switcheroo.first-unit" }
              },
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
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Swap the Might of two units at the same battlefield this turn."
} satisfies CardProgram;

export default switcheroo;
