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
 * the golden test really executes the Might half, but two dependencies are
 * still missing:
 * - "give a unit -2 [M] this turn, to a minimum of 1 [M]" now uses the merged
 *   continuous.might instruction (RIFT-258; signed amount, printed minimum,
 *   end-of-turn expiry). What is missing is the static CardProgram -> chain
 *   binding layer (RIFT-257) that would register the card's triggered body;
 *   the golden test drives the merged primitive with the card's own args.
 * - [Hidden] (811) is declared, and effects/keywords/Hidden.ts is merged, but
 *   nothing expands card-program keywords, and the Hide discretionary action
 *   plus facedown play (811.1.c, 811.1.d) needs cost.hidden / cost.pay /
 *   effect.zone (RIFT-261) with its facedown-zone path.
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
    "两处依赖未合入：(1)「give a unit -2 [M] this turn, to a minimum of 1 [M]」已改用已注册的 continuous.might 原语" +
    "（RIFT-258：带符号增减、印刷下限 478.1.c、回合结束到期；本卡测试真实执行该指令并验证 -2 后钳到 1 及到期），" +
    "但静态卡程序到链/图层的绑定层（RIFT-257）尚未合入，该触发体在生产路径里不会被注册执行。" +
    "(2) [Hidden]（811）的展开不可执行：没有代码把卡牌程序的 keyword 交给 effects/keywords/Hidden.ts 展开，" +
    "Hide 行动与背面打出依赖 cost.hidden / cost.pay / effect.zone 及 Facedown Zone 路径（RIFT-261）；" +
    "811.1.d.3 的「背面永久物的打出效果只能选其被打出战场上的单位」属目标系统（RIFT-90）。" +
    "依赖：RIFT-257 卡牌程序绑定、RIFT-261 cost.hidden/cost.pay、RIFT-90。不近似实现。",
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
