import type { CardProgram } from "../../ir/index.js";

/**
 * Frigid Touch — sfd-066-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] [2] (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit -2 [M] this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry.
 * - [Repeat] [2] (820) is an Optional Additional Cost keyword: 820.1.d makes
 *   the paid instance execute the spell's instructions one additional time
 *   during resolution, with choices re-made (820.2 / 820.2.a). The 2-energy
 *   optional additional cost is declared on the play CostSpec (contract 3.1).
 *   The production resolver reads the exact paid instance ids from the frozen
 *   cost plan/receipt and repeats this body; the card does not write a fixed
 *   repeat count or carry an effect.repeat action template as a substitute.
 * - "Give a unit -2 [M] this turn" is a temporary Might modification executed
 *   by the merged continuous.might primitive (RIFT-258): contract 3.4's
 *   arithmetic layer and end-of-turn duration. The body can therefore be
 *   repeated directly without translating -2 Might into Buff counters.
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，唯一剩余缺口是
 * CR 820.2.a 的额外执行重选。Payment collection and paid-instance execution
 * now work in production, but chain/interpreter-adapter.ts:230 wraps a paid
 * whole body in `repeat` with `reselectTargets: false`; chain/engine.ts:727
 * finalizes the original TargetSpec only once and chain/engine.ts:665 merges
 * those selections by specification id. The paid execution therefore cannot
 * choose a different legal unit, although 820.2.a explicitly permits it.
 * Card IR cannot manufacture that second Finalize choice, so the card remains
 * judge-required until the engine freezes one target choice per paid instance.
 */
const frigidTouch = {
  canonicalCardId: "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一缺口是 CR 820.2. / 820.2.a 的 Repeat 额外执行重选：付费费用收集与 paid-instance 次数接线已合入，" +
    "但 packages/engine-core/src/chain/interpreter-adapter.ts:230-238 把整个正文包装成 repeat 时固定 " +
    "reselectTargets: false；packages/engine-core/src/chain/engine.ts:727-762 只为原始 TargetSpec finalize 一次，" +
    "engine.ts:665-671 又按 spec id 合并目标计划。因此额外执行只能复用第一次选择的单位，不能按 820.2.a 另选另一个“unit”。" +
    "卡牌 IR 不伪造第二个 Finalize choice，也不使用 buff 代替 Might。已由生产 golden 验证：拒绝 Repeat 时只支付 2 能量并执行一次，" +
    "支付后总计 4 能量且真实重复 continuous.might；目标在结算前失效时 ignored，均不产生 Buff counter；整卡因缺少额外执行重选仍保持 judge-required。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "give-minus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            // 契约 3.6：作用对象经 objects 描述符指向 Finalize 锁定的 TargetSpec；
            // 生产链适配器按该描述符读取 ctx.targets，重选目标（820.2.a）由 repeat 承担。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "affected-unit" }
            }
          },
          targets: [
            {
              id: "affected-unit",
              filter: { types: "unit" },
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default frigidTouch;
