import type { CardProgram } from "../../ir/index.js";

/**
 * Disintegrate (ogn-005-298) — Spell, 4 Energy, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield. If this kills it, draw 1.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 4, power null (no printed Power), might
 * null, tags [].
 *
 * Status: judge-required. The damage half is fully expressible; the second
 * sentence's gate is not:
 * - "If this kills it" references the Game Action performed by the previous
 *   instruction (359.3.e.14 calls these linked instructions, and 359.3.e.14.b
 *   makes "if you do" directly reference that action: if the kill is replaced
 *   or never happens, the later instruction must not execute). It is modeled as
 *   a linked instruction for exactly that reason; an unconditional Draw 1 would
 *   be an approximation of the opposite failure mode.
 * - The merged effect.damage primitive links only `dealt`, `dealtTo` and
 *   `dealtCount`; it never reports lethal damage. A kill caused by damage is
 *   attributed by the cleanup/event pipeline (429.1.a.2 describes passive kill
 *   via Lethal Damage in a Cleanup; 429.5.c attributes it to the spell), which is
 *   where the death timing point is emitted. The frozen IR has no result
 *   binding or predicate for "the object this instruction damaged died" (RIFT-9
 *   lists condition.result as a required but unmerged primitive, and the survey
 *   entry for this printing asks for a reflexive trigger).
 * - The draw instruction therefore reads the missing result binding
 *   `disintegrate.deal-3.killed`. The merged interpreter treats an unavailable
 *   linked value as missing information and ignores the guarded instruction
 *   (contract 3.4: 缺信息 → ignored, 不伪造 0), verified by the golden test, so
 *   the current card fails closed instead of drawing unconditionally.
 *
 * Dependencies: RIFT-9 condition.result / "if you do" result binding, the
 * lethal-damage→kill attribution in the cleanup and event pipeline (429.5.c,
 * docs/plans/survey/unclassified-ogn.json proposes trigger.reflexive for this
 * printing), and RIFT-90 for the battlefield-restricted target.
 */
const disintegrate = {
  canonicalCardId: "card.hash-59023abea680c1ec0358c2f407d08193931447ee6c2b18ad3f0a0588b4f6501f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If this kills it」是结果条件，依赖前一条指令实际执行过的消灭动作（359.3.e.14；359.3.e.14.b：\"if you do\" 直接" +
    "引用该动作，被替代或未发生就不能执行），已合入的 effect.damage 只链接 dealt / dealtTo / dealtCount，不报告伤害是否致命；" +
    "伤害造成的消灭归因（429.5.c）与死亡时点属于清理与事件管线，冻结 IR 没有对应结果绑定或谓词" +
    "（RIFT-9 的 condition.result 未合入；survey 对本印刷号提出 trigger.reflexive）。" +
    "条件读取的结果绑定 disintegrate.deal-3.killed 目前无生产者，解释器按契约 3.4 以缺信息 ignored 处理（失败关闭，" +
    "不会退化成无条件 Draw 1，golden 测试固定该行为）。依赖：condition.result 结果绑定、致命伤→消灭归因、RIFT-90 战场目标系统。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. If this kills it, draw 1.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost is 4 Energy; this printing has no Power value (null in the
      // catalog), so no Power component is declared (null ≠ 0).
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 }
      },
      body: [
        {
          id: "disintegrate.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "disintegrate.unit-at-battlefield" }
          },
          targets: [
            {
              id: "disintegrate.unit-at-battlefield",
              filter: { type: "unit", zone: "board" },
              location: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "If this kills it, draw 1." Linked because "this" references the
          // kill performed by the damage instruction (359.3.e.14.b); the
          // condition reads the result binding the missing if-killed primitive
          // must produce, so until then the draw is ignored rather than run.
          id: "disintegrate.draw-if-killed",
          op: "effect.draw",
          linkedTo: "disintegrate.deal-3",
          condition: {
            kind: "expression",
            value: {
              kind: "linked-value",
              instructionId: "disintegrate.deal-3",
              key: "killed"
            }
          },
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default disintegrate;
