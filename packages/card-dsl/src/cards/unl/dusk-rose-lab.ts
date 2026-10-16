import type { CardProgram } from "../../ir/index.js";

/**
 * Dusk Rose Lab (unl-209-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-209-219, 逐字):
 *   "At the start of your Beginning Phase, you may kill a unit you control
 *    here to draw 1. (This happens before scoring.)"
 *
 * CR v1.5 anchors:
 * - 315.2.a.1: "At the start of your Beginning Phase" is the Beginning Step,
 *   the closed timing point `beginning-start`; 315.2.b is the later Scoring
 *   Step that the printed parenthetical contrasts with, so the reminder adds no
 *   separate ability (135.2.b: reminder text restates rules).
 * - 190.6.d: "you"/"your" in a battlefield's abilities is the Battlefield's
 *   Controller, and the printed "your Beginning Phase" is therefore that
 *   controller's Beginning Phase. `turn/flow.ts` emits `beginning-start` with
 *   the turn player, so the EventPattern gate is the merged player selector
 *   `player: "self"` (event player = ability controller) once the 190.6
 *   controller binding exists.
 * - 383.3.b / 383.3.b.1: the "you may" appears as the first part of the
 *   effect and "kill a unit you control here" immediately follows it, so the
 *   kill is the base cost of the triggered ability and must be paid to
 *   finalize the ability to the chain.
 * - 355.10.c / 355.10.c.1: "[do X] to [do Y]" costs inside instructions do not
 *   target; the killed unit is a resolution-time non-target selection (a
 *   `picks` entry), not a TargetSpec.
 * - 429.1 / 429.2.a: "kill" is the active Kill action; the merged effect.kill
 *   performs it and publishes the `killed` receipt.
 * - 359.3.e.14.b: "to draw 1" is linked to the kill action, so a replaced or
 *   impossible kill must not draw; the draw reads the kill's own receipt.
 * - 414.1 / 414.3: "draw 1" is effect.draw for the implicit "you" (190.6.d).
 *
 * Status: judge-required — two merged gaps, neither approximated:
 * 1. The kill is the triggered ability's base cost (383.3.b), but no merged
 *    primitive charges a cost-inside-an-instruction at Finalize: the cost
 *    plan workstream has no `cost.sacrifice`/cost instruction, and even the
 *    merged `cost.pay` shape has no instruction file. Writing the kill as a
 *    resolving `effect.kill` (as below, following the merged
 *    ogn/monastery-of-hirana precedent for the same "may pay X to get Y"
 *    wording) records the printed cost/effect linkage but does not put the
 *    kill at its 383.3.b finalize timing.
 * 2. No merged subscriber turns a CardProgram's triggered ability into a
 *    TriggerRegistration, and the Battlefield-controller binding of 190.6 is
 *    not resolved for a battlefield program, so the `beginning-start` trigger
 *    cannot be attached to this source.
 * The kill and the draw themselves are merged primitives, and the golden test
 * executes the card's own body through the real interpreter (accept, kill,
 * conditional draw; decline; replaced kill) exactly as the merged precedents
 * do. Dependencies: RIFT-89 (finalize-locked cost within an instruction /
 * cost.sacrifice) and RIFT-120 follow-up (card-program trigger registration
 * with 190.6 battlefield-controller binding).
 */
export default {
  canonicalCardId: "card.hash-979c0c88664ea7abe8ba5d613868eeb8569d56983d9d9b734d3ef2d55ca0e6c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处已合入缺口，均不近似实现：(1) 383.3.b/383.3.b.1 把「you may kill a unit you control here」（紧跟在效果开头 " +
    "的 you may 之后）规定为该触发能力的 base cost，必须在 finalize 支付；合并原语没有在 finalize 收取「指令内费用」的路径" +
    "（effect/instructions 下没有 cost.sacrifice / cost 类指令，连 cost.pay 形状也没有指令文件，RIFT-89）。" +
    "本程序按已合入的 ogn/monastery-of-hirana 同型写法把消灭写成结算期 effect.kill + 条件抽牌，保留印刷的 cost→effect 链接，" +
    "但不宣称已满足 383.3.b 的 finalize 时机。(2) 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，" +
    "190.6 的战场能力控制者绑定也未落地，beginning-start 触发无法挂到本来源。" +
    "已支持部分：消灭（非目标 picks，355.10.c.1）与抽牌（414.1/414.3，读消灭的 killed 回执，359.3.e.14.b）都是已合入原语，" +
    "golden 用真实解释器执行本卡 body（接受／拒绝／死亡被替代）。依赖：RIFT-89 与 RIFT-120 后续。",
  sourceText:
    "At the start of your Beginning Phase, you may kill a unit you control here to draw 1. " +
    "(This happens before scoring.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "beginning-start",
        // 315.2.a.1 + 190.6.d: the Beginning Step of the Battlefield
        // controller's own turn. branch/flow emits the point with the turn
        // player, and "self" is the merged spelling for the ability's
        // controller (used by the newest merged card programs).
        filter: { event: "beginning-start", player: "self" }
      },
      // 383.3.b: "you may" as the first part of the effect is the ability's
      // finalize decision (declining removes the trigger from the chain).
      optional: true,
      body: [
        {
          id: "dusk-rose-lab.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Kill a unit you control here to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "dusk-rose-lab.sacrifice",
                  op: "effect.kill",
                  args: {
                    // 355.10.c.1: the kill is a cost inside the instruction,
                    // so the unit is a non-target pick, not a TargetSpec.
                    picks: { kind: "constant", value: "dusk-rose-lab.unit-here" }
                  },
                  picks: [
                    {
                      id: "dusk-rose-lab.unit-here",
                      options: ["unit-you-control-here"],
                      // "a unit you control here": the ability's controller
                      // (190.6.d) and this Battlefield (053.3).
                      filter: {
                        type: "unit",
                        zone: "board",
                        controller: "self",
                        sameLocationAs: "self"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "dusk-rose-lab.draw",
                  op: "effect.draw",
                  // "… to draw 1" is linked to the kill action (359.3.e.14.b):
                  // a replaced/impossible kill leaves the receipt empty and
                  // the draw does not happen.
                  linkedTo: "dusk-rose-lab.sacrifice",
                  condition: {
                    kind: "compare",
                    left: {
                      kind: "linked-value",
                      instructionId: "dusk-rose-lab.sacrifice",
                      key: "killed"
                    },
                    operator: "ne",
                    right: { kind: "constant", value: [] }
                  },
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
