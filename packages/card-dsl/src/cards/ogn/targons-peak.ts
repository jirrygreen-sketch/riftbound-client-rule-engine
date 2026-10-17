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
 * Still missing: conquer -> conquered event normalization, a battlefield-relative
 * here anchor, and a card-facing delayed-trigger instruction with a one-turn
 * expiry. The runes must be chosen when that delayed trigger Finalizes, not
 * when the original conquer trigger resolves.
 */
const targonsPeak = {
  canonicalCardId: "card.hash-443bbd81ca54ffdeed5341da932702bf2c62ea4d20d8be07b4fbfc36c4340493",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "conquer 时点已由 TurnFlow 的真实征服/Score 流程产生（CR 473.2.a），CardProgram 触发绑定也已合入；仍缺 trigger " +
    "filter 的 conquer→conquered 事件适配与战场相对 here 锚点。trigger.delayed 尚无指令实现，内部 " +
    "registerDelayedTrigger 没有到期窗口参数，不能表达「at the end of this turn」的一次性本回合延迟触发（391.2）。" +
    "延迟触发还需在其自身 Finalize 时绑定非目标符文选择（355.5.b），不能在征服触发结算时预选。effect.ready 半段有真实执行证据；" +
    "整卡仍缺延迟注册/到期与选择生命周期，不近似实现。",
  sourceText: "When you conquer here, ready 2 runes at the end of this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
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
