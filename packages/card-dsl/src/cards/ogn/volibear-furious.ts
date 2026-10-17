import type { CardProgram } from "../../ir/index.js";

/**
 * Volibear, Furious (ogn-041-298) — Unit, 10 energy + 2 Fury power, Might 9.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-041-298):
 *   [Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose
 *   me with a spell or ability.)
 *   When I attack, deal 5 damage split among any number of enemy units here.
 *
 * Rules evidence (Core Rules v1.5):
 * - Deflect (809) is a Passive Ability keyword, valued (809.1.b) and stacking
 *   by sum (809.1.c); the card only declares `{ keyword: "deflect", value: 2 }`,
 *   its expansion (a target tax of two rainbow runes, 809.1.b.1/.b.2) lives in
 *   effects/keywords/Deflect.ts + the target/cost systems (contract 3.7).
 * - "When I attack" is an Attack Trigger (383.4.e, 383.4.e.1); its timing
 *   point is the closed enum member `attack-declared`. The trigger is checked
 *   once per combat (383.4.e.2.a), so the trigger declares once: "per-combat".
 * - "deal 5 damage split among any number of enemy units here" is splitting
 *   (355.14): every chosen unit is Targeted (355.14.a), the number of targets is
 *   at most the printed damage (355.14.c), and "any number" includes zero
 *   (355.13). Each target must receive a positive amount, decided at resolution
 *   (355.14.e/.f/.g), so the instruction carries `divide: true` and one
 *   TargetSpec with selection "up-to" / min 0 / max 5.
 * - "here" is a referent to the ability source's location (359.3.f), expressed
 *   with the contract 3.6 `sameLocationAs` anchor; the interpreter resolves it
 *   against the current source location at resolution time.
 *
 * Status: judge-required. Two rules integrations remain blocked, so the whole
 * card cannot honestly be called executable:
 * - the `attack-declared` timing point still has no emitter: combat/flow.ts
 *   throws TurnCombatBlockedError('combat-start-transaction') for combat start,
 *   so the trigger cannot enter the chain (P0 contract 7.2 batch 5
 *   Turn/Combat/priority-focus);
 * - the CardProgram keyword expansion and target-tax declaration are merged,
 *   but target-plan currently converts the tax to an Energy-shaped mandatory
 *   additional cost; it does not enforce the printed two-rainbow-rune Power
 *   payment (809.1.b.1/.b.2).
 * The split-damage instruction itself is merged (effect.damage divide) and is
 * executed by the golden test against the reference kernel.
 */
export default {
  canonicalCardId: "card.hash-3945b807e4fed55c0e3bd1ea8f5f24a46e04bea3379a8e559da6db0f73a173cc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) attack-declared 时点没有已合入的发射方：combat/flow.ts 的战斗开始仍抛 " +
    "TurnCombatBlockedError('combat-start-transaction')（P0 契约 7.2 批 5 Turn/Combat/priority-focus），" +
    "攻击触发无法进入链；（2）[Deflect 2]（809.1.b/c）的展开不可执行：目标税需要按 809.1.b.1/.b.2 由对手以两个 rainbow rune 支付，" +
    "而已合入的 target.tax 消费方只把税额追加成 energy 形态的 mandatory additional cost（target-plan.ts / chain/engine.ts），" +
    "卡牌程序 keyword 展开和 target.tax 声明路径已经合入，但 target-plan/chain 仍把税转成 energy 形态的 mandatory additional，" +
    "没有按 809.1.b.1/.b.2 强制两个 rainbow rune 的 Power 支付。依赖：combat 时点发射与 Deflect rainbow-rune tax/payment 适配。不近似实现；" +
    "「deal 5 damage split」本体用已合入的 effect.damage divide 在 golden 中真实执行。",
  abilities: [
    { kind: "keyword", keyword: "deflect", value: 2 },
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "volibear.split-damage",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 5 },
            target: { kind: "constant", value: "volibear.enemy-units-here" },
            // 355.14: split damage; each target's share is chosen at resolution.
            divide: { kind: "literal", value: true }
          },
          targets: [
            {
              id: "volibear.enemy-units-here",
              filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
              min: 0,
              max: 5,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When I attack, deal 5 damage split among any number of enemy units here."
} satisfies CardProgram;
