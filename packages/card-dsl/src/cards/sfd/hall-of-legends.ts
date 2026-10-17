import type { CardProgram } from "../../ir/index.js";

/**
 * Hall of Legends (sfd-210-221) — Battlefield, SFD.
 *
 * "When you conquer here, you may pay :rb_energy_1: to ready your legend."
 *
 * Rules anchors (Core Rules v1.5):
 * - "When you conquer here" is a Conquer Effect of the battlefield's
 *   controller (190.6.a/190.6.d, 383.4.c, 471.1, 473.2.a); the closed conquer
 *   timing point is emitted by the merged scoring wave (turn/flow.ts, with the
 *   battlefieldId detail).
 * - "you may pay [1 energy]" is a cost within an instruction paid at
 *   resolution (204.3.a, 205); the 383.3.b question (base cost when the paid
 *   clause directly follows "you may" at the start of the effect) applies
 *   here too and has no TriggeredAbility cost slot.
 * - "your legend" does NOT target: 355.10.g makes a legend "you" control an
 *   exception to targeting ("Ready your legend" is the rulebook's own
 *   example). The legend is chosen at resolution, so it is a non-target
 *   selection inside effect.ready's choose descriptor, not a TargetSpec. The
 *   golden executes that choose selection through the production adapter.
 * - Ready is the 416.1 action; a legend is a game object that can be readied
 *   (174.6-174.8, 415.3.a), and 416.1.b/416.1.c make readying an already-ready
 *   object a no-op.
 *
 * Status rationale (cards/README.md §2): judge-required. The conquer trigger
 * is emitted, the optional wrapper and the effect.ready primitive (including
 * its resolution-time choose) are merged and executed by the golden, but the
 * 1-energy payment is not: effects/instructions/ has no cost.pay primitive
 * (RIFT-261 owns the cost.pay / cost.modify batch), so "you may pay [1]" has
 * no executable path and the whole optional chain cannot be declared
 * executable. The "here" anchor is also still unrepresentable: the program
 * binding rejects the filter field (translateObjectFilter throws "Unsupported
 * filter field here"), so the trigger cannot bind to this battlefield's
 * location. Nothing is approximated by free readying or a fabricated payment.
 */
export default {
  canonicalCardId: "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「you may pay :rb_energy_1: to ready your legend」的支付无法真实执行：1 能量是结算期费用" +
    "（204.3.a/205；383.3.b 的基础费用问题也适用），但 effects/instructions/ 没有 cost.pay 原语" +
    "（结算期费用支付属 RIFT-261 批次，未合入），整条可选结算链不能标记 executable。" +
    "触发侧：conquer 时点已由 turn/flow.ts 的计分 wave 发出（details.battlefieldId），但卡牌程序绑定" +
    "（RIFT-257 已合入）的过滤器翻译不接受 \"here\" 字段（translateObjectFilter 抛 \"Unsupported filter field here\"），" +
    "本卡无法锚定到自己所在的战场。" +
    "已可真实执行的部分：choice.optional 本体与 effect.ready 的非目标 choose 形状（355.10.g：" +
    "「your legend」不选中目标），golden 经 chain/interpreter-adapter.ts 的生产适配器执行就绪动作" +
    "（含已就绪无操作的 416.1.c 分支）。契约 3.1 的 TriggeredAbility 也没有 cost 槽位承载 383.3.b 的费用。" +
    "依赖：RIFT-261（cost.pay）、conquer 触发的 \"here\" 锚点载荷。不近似实现（不做免费 ready，也不伪造支付）。",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to ready your legend.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "self" }
      },
      optional: true,
      body: [
        {
          id: "hall-of-legends.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to ready your legend?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 204.3.a/205: the printed payment inside the resolving body.
                  // No merged primitive executes it yet (RIFT-261); the pending
                  // op fails closed rather than readying for free.
                  id: "hall-of-legends.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 }, power: { kind: "constant", value: [] } }
                },
                {
                  id: "hall-of-legends.ready",
                  op: "effect.ready",
                  linkedTo: "hall-of-legends.pay",
                  args: {
                    objects: {
                      kind: "constant",
                      value: {
                        kind: "choose",
                        id: "hall-of-legends.legend",
                        filter: { type: "legend", controller: "self" },
                        min: 1,
                        max: 1
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
