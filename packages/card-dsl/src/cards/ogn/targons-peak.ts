import type { CardProgram } from "../../ir/index.js";

/**
 * Targon's Peak (ogn-289-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-289-298):
 *   "When you conquer here, ready 2 runes at the end of this turn."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1: "When you conquer here …" is a Conquer Effect (the
 *   closed `conquer` timing point, 468.5.d / 471.1 / 473.2.a).
 * - 391.2 / 382: "ready … at the end of this turn" is a Delayed Trigger — a
 *   Triggered Ability with a specific frame of time as its restriction, not an
 *   instruction resolved immediately.
 * - 355.5.b names this exact card: the choices involved are not made when
 *   finalizing the conquer effect but when finalizing the resulting delayed
 *   trigger at the end of the turn.
 * - 416.1: readying a rune readies it; effect.ready is the merged primitive
 *   for the action, and 417.1.b / 108.5 place runes in the Rune Zone.
 *
 * Status: judge-required.
 * TurnFlow produces conquer events and program trigger binding is merged.
 * Still missing: a battlefield-relative here anchor, and a card-facing
 * delayed-trigger instruction registering a one-use end-of-turn ability. The runes
 * must be chosen when that delayed trigger Finalizes, not
 * when the original conquer trigger resolves.
 */
const targonsPeak = {
  canonicalCardId: "card.hash-443bbd81ca54ffdeed5341da932702bf2c62ea4d20d8be07b4fbfc36c4340493",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 conquer 触发的战场相对 here filter 绑定（CR 473.2.a）。trigger.delayed 仍无卡牌指令实现，" +
    "需通过 registerDelayedTrigger 登记一次性 turn-end 能力（391.2/392），不能直接结算 effect.ready。" +
    "还缺延迟触发自身 Finalize 时的符文选择计划（355.5.b）：当前描述式 controller-runes pick 没有 Finalize 消费方，" +
    "不能提前选择或以有序区域切片代替玩家选择。不近似实现。",
  sourceText: "When you conquer here, ready 2 runes at the end of this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "targons-peak.ready-2-runes",
          // Unregistered placeholder for the delayed-trigger instruction:
          // registering the end-of-turn delayed trigger has no merged
          // implementation (see judgeReason).
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "turn-end" },
            window: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "targons-peak.ready",
                  op: "effect.ready",
                  args: {
                    // Non-target pick descriptor (merged effect.ready spelling;
                    // sfd/veiled-temple.ts precedent): the runes are chosen when
                    // the delayed trigger is finalized (355.5.b), never while the
                    // conquer effect resolves.
                    objects: { kind: "constant", value: { kind: "pick", id: "targons-peak.runes" } },
                    amount: { kind: "constant", value: 2 }
                  },
                  picks: [
                    {
                      id: "targons-peak.runes",
                      options: ["controller-runes"],
                      filter: { type: "rune", zone: "rune-zone", controller: "self" },
                      min: 1,
                      max: 2,
                      selection: "up-to"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default targonsPeak;
