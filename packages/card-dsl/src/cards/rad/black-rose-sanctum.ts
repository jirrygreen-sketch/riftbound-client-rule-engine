import type { CardProgram } from "../../ir/index.js";

/**
 * Black Rose Sanctum (rad-159-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   For each player, the first time each turn a non-token unit they control
 *   dies here, they play a 1 :rb_might: Recruit unit token to their base.
 *
 * Rules evidence (Core Rules v1.5):
 * - 429.1 / 429.2.a: a unit Dying is it going from the Board to its owner's
 *   Trash; the "object-killed" timing point (events/timing-points.ts, refs
 *   429.1 / 808.1.d) is the merged subscription point and carries the last
 *   known snapshot of the dying object.
 * - 187.1: a 1 Might Recruit is a domainless unit token with 1 Might and the
 *   Recruit tag; it is a merged definition in effect.token.
 * - 440.2.c / 185.2.a / 350.2 / 354: playing a NEW token means creating it on
 *   the Chain and then playing it, which is why the intended body declares
 *   effect.token with mode "play" rather than a direct Board creation.
 * - 383.3.e.1: "the first time each turn" is a frequency limit on the trigger.
 *
 * Status: judge-required. Three merged gaps, none approximated:
 * - The token goes to "their base" — the base of the player who controlled the
 *   dying unit, which is NOT the ability's controller. effect.token refuses
 *   any unit Base other than the ability controller's
 *   ("Only the controller's base is a legal unit base destination"), and the
 *   frozen create-token action carries no destination player. The authored
 *   location is the controller-base placeholder for that missing player-scoped
 *   destination; it is not the printed semantics.
 * - "For each player ... the first time each turn" is a per-player-per-turn
 *   frequency on a single card ability. TriggerSpec.once only offers
 *   per-turn / per-combat / per-chain / per-game for one registration, so
 *   encoding once: "per-turn" would wrongly allow only one trigger per turn
 *   across both players instead of one per player.
 * - Playing the new token still needs the create-token "chain" destination and
 *   the finalized cost plan (185.3.a.1 treats a token's cost as 0) that the
 *   merged cost system owes (RIFT-89); the reference kernel models the
 *   handoff, the production flow does not.
 * The trigger and the intended body stay recorded so the shape is reviewable.
 */
export default {
  canonicalCardId: "card.hash-bb13774c245790dac24ea6928494dad2f51a511704b3a77b260531f06ae67788",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「they play a 1 [M] Recruit unit token to their base」三处缺口：" +
    "（1）Token 目的地是每个死亡单位控制者的基地（\"their base\"），不是能力控制者的基地；" +
    "effect.token 明确只允许能力控制者的基地作为单位 Token 目的地，frozen create-token 动作也不携带目的地玩家；" +
    "（2）「For each player, the first time each turn」是按玩家计的每回合首触发上限，TriggerSpec.once 只有单个注册的 per-turn/per-combat/per-chain/per-game，" +
    "写成 once:\"per-turn\" 会把两名玩家整体限成每回合一次，属错误近似；" +
    "（3）新 Token 的「打出」仍需 create-token(to:chain) + 已 Finalize 的费用计划（440.2.c / 185.2.a / 185.3.a.1），依赖 RIFT-89。" +
    "Trigger 与效果形状（Recruit 187.1、mode: play、controller-base 占位）已保留供审查；不近似实现。",
  sourceText:
    "For each player, the first time each turn a non-token unit they control dies here, they play a 1 :rb_might: Recruit unit token to their base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "a non-token unit they control dies here" — the dying object
          // filter names any player's unit (375.10-style unit reference).
          object: { type: "unit", controller: "any" },
          // "here", the non-token restriction and the per-player window are
          // descriptive keys the merged EventPattern cannot express: it has no
          // source-battlefield anchor (here), no token exclusion (nonToken),
          // and no per-player frequency (perPlayerFrequency). They are kept so
          // the intended condition is reviewable, not as executable semantics.
          here: true,
          nonToken: true,
          perPlayerFrequency: "once-per-turn"
        }
      },
      optional: false,
      body: [
        {
          // "they play a 1 [M] Recruit unit token to their base" — Recruit is
          // the merged 187.1 definition; play mode is the printed "play"
          // (440.2.c / 185.2.a). The location is the controller-base
          // placeholder for the missing per-player destination.
          id: "black-rose-sanctum.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
