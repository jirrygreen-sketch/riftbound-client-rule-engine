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
 * Status: judge-required. The printed ability maps onto merged machinery, and
 * the golden test really executes the Might half, but the Hidden half still
 * has an unconnected production path:
 * - "give a unit -2 [M] this turn, to a minimum of 1 [M]" now uses the merged
 *   continuous.might instruction (RIFT-258; signed amount, printed minimum,
 *   end-of-turn expiry), and the card-played trigger shape is supported by the
 *   program binding. The golden test drives the merged primitive with the
 *   card's own args.
 * - [Hidden] (811) is declared and expands to the merged cost.hidden shape, but
 *   the Hide discretionary action plus facedown play (811.1.c, 811.1.d) still
 *   have no connected cost/zone path.
 * - 811.1.d.3 (a play effect of a hidden permanent restricts its targets to
 *   units at the battlefield it was played to) is a target-system rule; the
 *   target list below states the general "a unit" targeting, and the hidden
 *   restriction belongs to the target/Finalize layer.
 * The golden test still checks the structure and asserts the printed numbers.
 */
export default {
  canonicalCardId: "card.hash-5babb90d79192ee6ca892489ae07370b086c015b0a2db49d665b82be90f4fcc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hidden 仍有一处依赖未接通；「give a unit -2 [M] this turn, to a minimum of 1 [M]」已改用已注册的 continuous.might 原语" +
    "（RIFT-258：带符号增减、印刷下限 478.1.c、回合结束到期；本卡测试真实执行该指令并验证 -2 后钳到 1 及到期），" +
    "触发体的 card-played 注册形状已可用；[Hidden]（811）的展开仍不可执行：cost.hidden 的 Hide 行动、" +
    "背面打出与 Facedown Zone 路径没有接入生产流程；811.1.d.3 的「背面永久物的打出效果只能选其被打出战场上的单位」" +
    "也没有目标系统消费者。依赖：Hidden 的费用/区域消费者与背面打出目标限制。不近似实现。",
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
