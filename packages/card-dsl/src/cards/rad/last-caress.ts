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
 *   may grant permission to play Units to locations that are not normally valid.
 *   It applies to exactly one unit — the next one played — which is a "next"
 *   limitation on the delayed ability, not a choice made now.
 * - "(even from face down)" excludes no play route here: a face-down card in a
 *   Facedown Zone is played to the battlefield it was played from (107.3), so a
 *   unit played from face down is still "a unit you play" for this permission.
 * - "When you play it, [Buff] it" is a delayed Triggered Ability (391.2) tied to
 *   that same next unit: it subscribes to the unit being played (420.4.a) and
 *   Buffs it. Buffing is the game action of placing a Buff counter, and a unit
 *   that already has one is not Buffed again (427.1.b.1 / 427.3).
 *
 * Status: judge-required (revalidated 2026-10-17). Gaps, none approximated:
 * - the recorded declarations do not survive the merged op schemas: the card
 *   passes an `once` argument that continuous.location rejects ("Invalid
 *   continuous.location argument: once"), and `trigger.delayed` is not a
 *   registered op at all (effects/instructions/registry.generated.ts), so
 *   describePlay also fails on the nested instruction targets
 *   ("Nested instruction targets require a target lifecycle adapter");
 *   ResolveContext.registerDelayedTrigger exists (contract 3.6) and
 *   chain/engine.ts can register a delayed trigger, but no card-facing op is
 *   merged, and the "next unit" restriction additionally needs a one-shot
 *   window that no merged trigger lifetime provides (TriggerSpec.once offers
 *   per-turn / per-phase / per-combat / per-showdown / per-chain /
 *   per-object / per-game, not once-per-qualifying-event);
 * - the delayed play-location permission still has no consumer that widens
 *   placement: chain/engine.ts playDestinationIsLegal reads only
 *   `no-base`/`cannot-*` style restriction *names*, so a permission such as
 *   "any-battlefield" never widens where the next unit may be played
 *   (355.2.b / 801.3.a);
 * - the delayed ability must be created by the resolving spell (393), so the
 *   card's own static ability would be wrong even if the ops existed.
 * Only the Buff body itself is executable today (see the golden).
 */
export default {
  canonicalCardId: "card.hash-f2018820e58aa6e64632838286e934b24f7c9c49687c3fc847be072739c1b123",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 已写下的声明过不了合并后的 op schema：continuous.location 拒绝本卡的 once 参数" +
    "（实测 “Invalid continuous.location argument: once”），trigger.delayed 根本不在注册表里；describePlay 也会因嵌套指令 targets 抛" +
    "“Nested instruction targets require a target lifecycle adapter”。ResolveContext.registerDelayedTrigger（契约 3.6）与 " +
    "chain/engine.ts 的注册路径已存在，但没有卡牌可用的 trigger.delayed op；「the next unit you play」还需要一次性" +
    "（首个合格事件后失效）的窗口——TriggerSpec.once 只有 per-turn / per-phase / per-combat / per-showdown / per-chain / per-object / per-game，" +
    "没有 once-per-qualifying-event。(2) 延迟的打出位置许可仍没有能放宽落点的消费方：chain/engine.ts 的 playDestinationIsLegal " +
    "只读 no-base / cannot-* 之类的限制名，permission（如 any-battlefield）不会放宽「下一个单位可以打到任意战场」（355.2.b / 801.3.a）。" +
    "(3) 按 393，延迟能力必须由结算中的法术创建，写成卡自身的静态能力是错误语义。" +
    "已合入并有执行证据的只有 Buff 本体（427.3，golden 用参考内核真实执行）。不近似实现。",
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
          // (see judgeReason); the shape follows the merged continuous.location
          // permission spelling.
          id: "last-caress.grant-play-location",
          op: "continuous.location",
          args: {
            permission: { kind: "constant", value: "any-battlefield" },
            appliesTo: {
              kind: "constant",
              value: { type: "unit", controller: "self", playOrder: "next" }
            },
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
