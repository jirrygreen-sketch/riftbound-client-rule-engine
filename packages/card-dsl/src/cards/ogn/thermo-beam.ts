import type { CardProgram } from "../../ir/index.js";

/**
 * Thermo Beam (ogn-022-298) — Spell, 5 Energy + 2 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Kill all gear.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 5, power 2 (Fury), might null, tags [].
 *
 * Status: judge-required. "Kill all gear" needs a characteristic-driven,
 * untargeted set kill, which the merged instruction set cannot express:
 * - The rules are explicit that this is not a choice and not targeting: 355.5
 *   gives "Kill all gear" as the example of text that is not a Choice, and
 *   355.10.d says an object selected programmatically by its characteristics,
 *   with no choice possible, is not targeted. So the effect must kill every gear
 *   currently on the board, with no selection step and no became-target events.
 * - The merged effect.kill resolves objects only from a finalized TargetSpec
 *   (ctx.targets), a PickSpec (ctx.picks), or the source itself (self: true).
 *   With count omitted it kills all resolved objects, but the resolved set
 *   always originates from one of those three sources. Neither is honest here:
 *   a TargetSpec — even with selection "all" — runs through the target
 *   finalization pipeline and emits became-target events, which 355.10.d
 *   forbids; a PickSpec requires the controller to choose the cards, which 355.5
 *   forbids. The primitive consumes target/picks/self/count/reason and requires
 *   a target, pick or self selector; an `objects` query supplies none of them.
 * - 178.3 and the 429.6 example ("Kill all gear") confirm the affected set is
 *   determined by the gear characteristic, including a unit that is also a
 *   gear, which is why a characteristic query is required rather than a target
 *   list.
 * The program below records the intended shape (one untargeted query kill) so
 * the card can be completed without re-deriving it; nothing is approximated as
 * executable.
 *
 * Dependencies: an untargeted each/all set selection consumed by effect.kill
 * (355.10.d, 355.5) — an extension of the merged primitive,
 * not a card-local implementation. The merged effect.kill still accepts only
 * target / picks / self: true. RIFT-682's scenario proves main-phase Action
 * admission only; it does not execute this unsupported query kill.
 */
const thermoBeam = {
  canonicalCardId: "card.hash-6a20eaa5d0de7ffae215ad7179d8429ac1a7b0cf0e32667d6cdaf0a546cc7edf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Kill all gear」不是目标选择（355.5 明示 Kill all gear is not a Choice；355.10.d：按特征程序化选出、无需选择的集合" +
    "不算目标），但已合入的 effect.kill 只能从 TargetSpec（ctx.targets）、PickSpec（ctx.picks）或来源自身解析对象" +
    "（args 消费 target/picks/self/count/reason；objects 查询不满足必需的对象来源）。用 selection: all 的 TargetSpec 会走目标锁定管线并发出" +
    "became-target 事件（与 355.10.d 冲突），用 PickSpec 又要求控制者逐张选择（与 355.5 冲突），两者都不是如实编码。" +
    "缺的是 effect.kill 可消费的无目标 each/all 集合选择；已合入的其他原语集合形态（effect.ready/effect.heal 的 " +
    "{ kind: \"query\", filter }）不能平移到 effect.kill。RIFT-682/RIFT-701 模板只验证主阶段 Action 入链、5 能量 + 2 Fury 力量支付与集合 kill 的失败证据（effect.kill requires args.target…），集合 kill 仍阻塞。不近似实现。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Kill all gear.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (energy 5 + 2 Fury power) comes from the catalog.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 5 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          // "Kill all gear." The untargeted characteristic query is stated for
          // review; the merged primitive cannot consume this shape yet.
          id: "thermo-beam.kill-all-gear",
          op: "effect.kill",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "query", filter: { type: "gear", zone: "board" } }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default thermoBeam;
