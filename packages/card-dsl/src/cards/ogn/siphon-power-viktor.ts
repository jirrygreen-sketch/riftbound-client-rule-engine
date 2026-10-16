import type { CardProgram } from "../../ir/index.js";

/**
 * Siphon Power, Viktor (ogn-266-298) — Spell, 2 energy + 1 Mind power
 * (Mind/Order, Viktor Signature).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a battlefield. Give friendly units there +1 :rb_might: this turn
 *   and enemy units there -1 :rb_might: this turn, to a minimum of 1
 *   :rb_might:.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the keyword registry
 *   owns its expansion (contract 3.7).
 * - "Choose a battlefield" chooses a Zone to affect, so it is a Choice and a
 *   target (355.5 / 355.7 / 355.9.a: a valid target is "a player or zone";
 *   355.10.b prints "Kill all units at a battlefield" as the example that
 *   targets the battlefield and not the units). In this IR a battlefield is a
 *   Zone object, so the choice is authored as a TargetSpec over it.
 * - "friendly units there" / "enemy units there" are programmatic sets chosen
 *   by criteria, not targets (355.10.d / 355.10.d.1: no choice over the units
 *   is ever possible), so they carry no TargetSpec: the instruction selects
 *   them with the sameLocationAs anchor over the chosen battlefield grouped by
 *   the spell controller's perspective.
 * - "+1 Might this turn" / "-1 Might this turn" are temporary Might
 *   modifications; contract 3.6's closed GameAction set has no
 *   Might-modification action, and effect.buff documents that Buff counters
 *   (702 / 703) are not temporary Might changes. The layers engine landed with
 *   RIFT-91 and its arithmetic layer applies increases before decreases
 *   (479.4.e.1 / 479.4.e.2), but no instruction primitive registers a
 *   continuous.might effect through ctx.addContinuous, so these instructions
 *   cannot execute.
 * - "to a minimum of 1 [M]" is the printed limitation on the decrease. 479.4.b
 *   snapshots such a limitation when the effect is applied, and the printed
 *   minimum is a floor on the amount actually subtracted: a verified layer
 *   check shows a plain -4 decrease takes a 2-Might unit to 0, so the floor is
 *   not implied by the merged arithmetic layer and must not be faked.
 * Status: judge-required — the Might modification, its end-of-turn lifetime and
 * the printed minimum-1 snapshot are unmerged primitives, not approximations to
 * be invented in card data.
 */
const siphonPower = {
  canonicalCardId: "card.hash-d619150ac39f656ea38c332ad3a03989be755c3114becae61bb346ae3996951d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺注册 continuous.might 的指令原语：“+1 Might this turn / -1 Might this turn”是带回合期限的临时 Might 修改，" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effect.buff 文件头明确 Buff 计数（702/703）不是 Might 修改；" +
    "图层引擎（RIFT-91）已能求值 arithmetic 层并按 479.4.e.1/e.2 先加后减，但 effects/instructions 下没有任何原语通过 " +
    "ResolveContext.addContinuous 注册它。另：「to a minimum of 1 M」是 479.4.b 的施加时快照下限，" +
    "实测已合入图层对 2 Might 单位施加 -4 会得到 0，说明该下限不是图层算术的隐含行为，必须由缺的原语承担，不得在卡牌数据里臆造。" +
    "“Choose a battlefield” 按 355.5/355.7/355.9.a 是区域目标（355.10.b 的示例），已按 TargetSpec 写出；" +
    "friendly/enemy units there 是 355.10.d 的程序化集合，不建目标。" +
    "依赖：continuous.might 指令原语（含 479.4.b 快照下限）与 target.location 地点目标形态。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a battlefield. Give friendly units there +1 :rb_might: this turn and enemy units there " +
    "-1 :rb_might: this turn, to a minimum of 1 :rb_might:.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "grant-plus-1-to-friendly-units",
          // "friendly units there +1 Might this turn" — a duration-bounded
          // Might modification over the programmatic set of friendly units at
          // the chosen battlefield. No merged opcode registers it.
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: {
              kind: "constant",
              value: {
                filter: {
                  type: "unit",
                  controller: "self",
                  sameLocationAs: { target: "chosen-battlefield" }
                }
                }
            }
          },
          // "Choose a battlefield": the affected Zone is chosen while making
          // the spell's relevant choices (355.5 / 355.7 / 355.9.a), so it is a
          // target rather than a filter of the unit sets. The location-target
          // form itself is not merged (see judgeReason); the unit sets anchor
          // on this spec with sameLocationAs.
          targets: [
            {
              id: "chosen-battlefield",
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "grant-minus-1-to-enemy-units",
          // "enemy units there -1 Might this turn, to a minimum of 1" — the
          // decrease carries the printed limit, which 479.4.b snapshots at
          // application time; the merged layer math has no such floor.
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            appliesTo: {
              kind: "constant",
              value: {
                filter: {
                  type: "unit",
                  controller: "opponent",
                  sameLocationAs: { target: "chosen-battlefield" }
                }
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default siphonPower;

