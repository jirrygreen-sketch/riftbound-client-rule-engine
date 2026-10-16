import type { CardProgram } from "../../ir/index.js";

/**
 * Blastcone Fae (ogn-097-298) — Unit, 2 energy + 1 Power, 2 Might, Mind,
 * Fae / Bandle City.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me, give a unit -2 :rb_might: this turn, to a minimum of
 *   1 :rb_might:.
 *
 * Status: judge-required.
 * - [Hidden] (811) is declared but its expansion is not executable: nothing
 *   registers the merged Hidden keyword (effects/keywords/Hidden.ts exists, but
 *   no chain/event code expands card-program keywords), and the Hide
 *   discretionary action plus facedown play (811.1.c, 811.1.d) needs
 *   cost.hidden / effect.zone / continuous.timing (RIFT-89, RIFT-91).
 * - "give a unit -2 [M] this turn, to a minimum of 1 [M]" is a temporary Might
 *   modification. effect.buff documents that temporary Might changes "belong
 *   to continuous.might, never to this primitive", the closed GameAction set
 *   has no might-modification action, and CR 478's layer engine is what applies
 *   the printed floor (an effect cannot take a unit below 1 Might). Not
 *   approximated with Buff counters.
 * - 811.1.d.3 (a play effect of a hidden permanent restricts its targets to
 *   units at the battlefield it was played to) is a target-system rule; the
 *   target list below states the general "a unit" targeting, and the hidden
 *   restriction belongs to the target/Finalize layer (RIFT-90).
 * The golden test still checks the structure and asserts the printed numbers.
 */
export default {
  canonicalCardId: "card.hash-5babb90d79192ee6ca892489ae07370b086c015b0a2db49d665b82be90f4fcc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合没有 might 修改动作，effect.buff 文档明确临时 Might 改变属于 " +
    "continuous.might 而非本原语（图层系统未合入），印刷的「to a minimum of 1」下限由 478 图层结算，无法表达。" +
    "[Hidden]（811）的展开同样不可执行：没有代码把卡牌程序的 keyword 交给 effects/keywords/Hidden.ts 展开，" +
    "Hide 行动与背面打出依赖 cost.hidden / effect.zone / continuous.timing（RIFT-89、RIFT-91）；" +
    "811.1.d.3 的「背面永久物的打出效果只能选其被打出战场上的单位」属目标系统（RIFT-90）。依赖：RIFT-89/90/91。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "blastcone-fae.give-minus-2",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "end-of-turn" },
            minimum: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "blastcone-fae.unit",
              filter: { type: "unit", zone: "board" },
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
    "When you play me, give a unit -2 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;
