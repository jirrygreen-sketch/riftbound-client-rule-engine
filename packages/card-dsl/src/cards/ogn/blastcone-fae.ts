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
 * The golden test still checks the structure and asserts the printed numbers;
 * the production-path execution evidence (play -> card-played -> Finalize
 * target lock -> continuous.might, the printed -2 and floor of 1 and the
 * illegal-target boundary) is the RIFT-660 template golden in
 * test/cards/templates/keyword-triggered-card-played-continuous-660.test.mjs.
 */
export default {
  canonicalCardId: "card.hash-5babb90d79192ee6ca892489ae07370b086c015b0a2db49d665b82be90f4fcc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Hidden 缺 Hide/Facedown Zone 行动、控制权与下回合解锁接线（CR 422.2.a、811.1.b/c）；" +
    "cost.hidden 的费用规划与支付不提供这些区域/时机许可。还缺 811.1.d.3 的来源于背面打出的历史信息与目标消费，" +
    "使 continuous.might 打出触发只在从 Hidden 打出时限制到该战场上的单位；普通打出的目标不能被同样收窄。" +
    "正文半段已可执行并经 RIFT-660 模板场景走生产链验证（play → card-played → 目标锁定 → continuous.might），" +
    "不能据此代替 Hidden 半段。",
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
            objects: { kind: "constant", value: { kind: "target", id: "blastcone-fae.unit" } },
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
