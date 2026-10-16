import type { CardProgram } from "../../ir/index.js";

/**
 * Orb of Regret (ogn-090-298) — Gear, 1 energy, Mind.
 *
 * Printed text:
 *   :rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1
 *   :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - 415.4 / 415.5: the leading :rb_exhaust: symbol is the cost "Exhaust this".
 * - 478.x: "-1 [M] this turn" is a temporary Might modification evaluated in
 *   the layers system with an end-of-turn duration; "to a minimum of 1 [M]"
 *   is the printed clamp on that modification.
 *
 * Status: judge-required — the exhaust cost is executable, but the effect
 * half has no merged implementation:
 * - contract 3.6's closed GameAction set has no Might-modification action, and
 *   effect.buff's own header states that temporary Might changes belong to the
 *   layers `continuous.might` effect, never to that primitive (it places Buff
 *   counters, 702/427);
 * - the layers engine can apply a `continuous.might`-style effect with an
 *   end-of-turn duration, but no instruction/pass registers one from a card
 *   program (no `continuous.might` opcode is merged; RIFT-91 owns the layers
 *   consumer), and the "minimum of 1 [M]" clamp has no merged enforcement path.
 * Using effect.buff instead would silently turn -1 Might into a Buff counter,
 * which the red line forbids; the intended shape is kept for review, and the
 * golden test only executes the exhaust payment.
 */
const orbOfRegret = {
  canonicalCardId: "card.hash-1ce54e160f6984f8d86e60ea1ad700d535426e0e5294239b98f64ec422574d96",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 的封闭 GameAction 集合没有 might 修改动作，" +
    "effect.buff 文档明确临时 Might 归 layers 的 continuous.might（放 Buff counter，702/427，" +
    "不等于 -1 Might）；当前没有任何已合入指令/通道把卡牌程序的 continuous.might 注册进图层" +
    "（RIFT-91），\"to a minimum of 1 [M]\"的下限钳制同样没有实现路径。" +
    "用 effect.buff 近似会把 -1 Might 变成 Buff counter，违反红线；费用（exhaust self）已可执行并由 golden 验证。",
  abilities: [
    {
      kind: "activated",
      cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
      timing: "action",
      body: [
        {
          // "Give a unit -1 [M] this turn, to a minimum of 1 [M]" — described
          // via the layers contract shape; no merged primitive consumes it yet
          // (see judgeReason).
          id: "give-minus-1-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -1 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "affected-unit",
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
    ":rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default orbOfRegret;
