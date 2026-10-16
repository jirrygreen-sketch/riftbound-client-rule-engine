import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Trove (ogn-186-298) — Gear, 2 Energy, Chaos.
 *
 * "When this leaves the board, draw 1 and channel 1 rune exhausted.
 *  :rb_rune_chaos:, :rb_exhaust:: Kill this."
 *
 * CR v1.5 anchors:
 * - 383.2.c.3: a triggered ability that triggers on its own source leaving the
 *   board is processed immediately before the zone change. The timing point is
 *   object-leaves-board; the source's last-known information is captured
 *   (383.2.c.3.b). Its effect (draw + channel) is independent of the source's
 *   post-change fate.
 * - 414: "draw 1" is effect.draw. 431 / 431.2: "channel 1 rune exhausted" is
 *   effect.channel with exhausted: true. Both primitives are merged and can
 *   execute.
 * - The second ability costs 1 Chaos Power plus "exhaust this" and kills the
 *   source. The cost plan recycles the source's current Board identity at
 *   Finalize (chain/README), then the effect kills it (429). effect.kill with
 *   self: true is merged; the cost exhaust is a finalized cost-plan payment.
 *
 * Status rationale: the draw, the exhausted channel and the kill-self
 * activation are each expressible with merged code and are exercised by the
 * golden tests below. The leave trigger itself stays judge-required because its
 * self-scoping is not executable end-to-end: the merged pipeline matcher has no
 * event-payload "self" binding (the nested filter in the RIFT-21 payload-filter
 * spelling is ignored by events/pipeline-match.ts, so a registered trigger would
 * match every leave event), and the CardProgram -> TriggerRegistration adapter
 * that binds the source incarnation and its active zone is RIFT-257 (in
 * progress). Partial primitive execution is not full-card evidence, so the card
 * keeps the judged status.
 */
const treasureTrove = {
  canonicalCardId: "card.hash-42b87e27f1b0c57a6160fc790e9257e741e6d8ec2e0f7a846d8aa0f6bcbe04f2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "离场触发的自身绑定尚不可执行：已合入的触发匹配器（events/pipeline-match.ts）不认识 RIFT-21 的 payload 过滤写法 " +
    "filter: { role: 'self' }，会把「此牌离场」触发匹配到任意离场事件；CardProgram → TriggerRegistration 的适配器" +
    "（绑定来源入区序号、activeZones 与 filter，RIFT-257 的 programs/triggers.ts）尚未合入；RIFT-257 的 " +
    "translateTriggerFilter 会把 role/self/objectId: 'self' 归一化为自身 objectId 锚点，因此整卡依赖 RIFT-257 落地。" +
    "draw 1、channel 1 exhausted、kill this 三个原语均已合入并各有执行测试，但局部原语执行不构成整卡证据；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-leaves-board",
        filter: { event: "object-leaves-board", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "treasure-trove.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "treasure-trove.channel",
          op: "effect.channel",
          args: {
            amount: { kind: "constant", value: 1 },
            exhausted: { kind: "constant", value: true }
          }
        }
      ]
    },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        power: { kind: "constant", value: ["Chaos"] },
        payments: [{ kind: "exhaust" }]
      },
      timing: "action",
      body: [
        {
          id: "treasure-trove.kill-self",
          op: "effect.kill",
          args: { self: { kind: "constant", value: true }, reason: { kind: "constant", value: "kill-this" } }
        }
      ]
    }
  ],
  sourceText:
    "When this leaves the board, draw 1 and channel 1 rune exhausted.\n" +
    ":rb_rune_chaos:, :rb_exhaust:: Kill this."
} satisfies CardProgram;

export default treasureTrove;
