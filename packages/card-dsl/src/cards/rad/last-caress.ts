import type { CardProgram } from "../../ir/index.js";

/**
 * Last Caress — rad-154-167 (Spell, Body/Chaos, 2 Energy, Evelynn / Signature).
 *
 * Printed text (verbatim, deck-catalog rad-154-167):
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    The next unit you play this turn (even from face down) can be played to any
 *    battlefield. When you play it, [Buff] it. (Give it a +1 :rb_might: buff if
 *    it doesn't have one.)"
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the play permission
 *   itself is expanded by the keyword registry (effects/keywords/Reaction.ts).
 *   Its reminder text is reminder text only and carries no rules meaning
 *   (135.2.d.3).
 * - "The next unit you play this turn ... can be played to any battlefield" is a
 *   Delayed Passive Ability (391.1 / 391.4) created by the resolving spell whose
 *   window is the turn (317.2.c): it widens the valid locations of the next unit
 *   the spell's controller plays beyond the default controller's Base or a
 *   battlefield they control (355.2.a). 355.2.b is explicit that such effects
 *   may grant permission to play Units to locations that are not normally
 *   valid. It applies to exactly one unit — the next one played — which is a
 *   "next" limitation on the delayed ability, not a choice made now.
 * - "(even from face down)" excludes no play route here: a face-down card in a
 *   Facedown Zone is played to the battlefield it was played from (107.3), so a
 *   unit played from face down is still "a unit you play" for this permission.
 * - "When you play it, [Buff] it" is a delayed Triggered Ability (391.2) tied to
 *   that same next unit: it subscribes to the unit being played (420.4.a) and
 *   Buffs it. Buffing is the game action of placing a Buff counter, and a unit
 *   that already has one is not Buffed again (427.1.b.1 / 427.3).
 *
 * Status: judge-required. Two merged gaps, neither approximated:
 * - there is no card-facing delayed-instruction op (RIFT-9 trigger.delayed):
 *   ResolveContext.registerDelayedTrigger exists (contract 3.6) and the chain
 *   engine can register a delayed trigger (chain/engine.ts), but
 *   effects/instructions/ registers no op that a card can use, and the "next
 *   unit" restriction additionally needs a one-shot window that no merged
 *   trigger lifetime provides (TriggerSpec.once offers per-turn / per-combat /
 *   per-chain / per-game, not once-per-qualifying-event);
 * - no merged op grants a play-location permission, and the card's own static
 *   ability would be wrong (393: Delayed Abilities are created by the resolving
 *   spell, not owned by a permanent). The recorded shape mirrors the merged
 *   play-location-permission effect kind used by sfd-093-221 Dauntless Vanguard.
 */
export default {
  canonicalCardId: "card.hash-f2018820e58aa6e64632838286e934b24f7c9c49687c3fc847be072739c1b123",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处未合入依赖：(1) 卡牌可用的延迟指令：ResolveContext.registerDelayedTrigger（契约 3.6）与 chain/engine.ts 的注册路径已存在，" +
    "但 effects/instructions/ 没有注册任何卡牌可用的 trigger.delayed op（RIFT-9 清单中的 trigger.delayed），" +
    "且「the next unit you play」需要一次性（首个合格事件后失效）的窗口，TriggerSpec.once 只有 per-turn / per-combat / per-chain / per-game，" +
    "没有 once-per-qualifying-event；" +
    "(2)「can be played to any battlefield」需要授予打出位置许可（355.2.b、801.3.a），" +
    "当前没有注册的持续效果原语可改写出牌位置，且按 393 也不能写成卡自身的静态能力（延迟能力由结算中的法术创建）。" +
    "依赖：RIFT-9 trigger.delayed、RIFT-90 目标/许可；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "The next unit you play this turn ... can be played to any
          // battlefield." Delayed Passive Ability created by this spell
          // (391.1 / 391.4, window = this turn per 317.2.c) widening the play
          // locations permitted by 355.2.a (355.2.b). No merged op creates it
          // (see judgeReason).
          id: "last-caress.grant-play-location",
          op: "continuous.play-location-permission",
          args: {
            appliesTo: {
              kind: "constant",
              value: { type: "unit", controller: "self", playOrder: "next" }
            },
            locations: { kind: "constant", value: ["battlefield"] },
            duration: { kind: "constant", value: "this-turn" },
            once: { kind: "constant", value: "next-qualifying-play" }
          }
        },
        {
          // "When you play it, [Buff] it." Delayed Triggered Ability (391.2)
          // subscribing to the next unit being played (420.4.a) and applying the
          // Buff game action (427.3, 427.1.b.1 限一). No merged op registers a
          // card-created delayed trigger (see judgeReason).
          id: "last-caress.delayed-buff",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "card-played" },
            filter: {
              kind: "constant",
              value: {
                event: "card-played",
                // The played unit is the event's object; "next" is the
                // once-only window the delayed registration must enforce.
                subject: { type: "unit", controller: "self", playOrder: "next" }
              }
            },
            duration: { kind: "constant", value: "this-turn" },
            once: { kind: "constant", value: "next-qualifying-play" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "last-caress.buff-played-unit",
                  op: "effect.buff",
                  args: {
                    mode: { kind: "constant", value: "buff" },
                    target: { kind: "constant", value: "last-caress.played-unit" }
                  },
                  targets: [
                    {
                      id: "last-caress.played-unit",
                      filter: { type: "unit", controller: "self" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "The next unit you play this turn (even from face down) can be played to any battlefield. " +
    "When you play it, [Buff] it. (Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;
