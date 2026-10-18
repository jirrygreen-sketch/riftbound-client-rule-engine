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
 * sentence's gate is not (measured 2026-10-17):
 * - "If this kills it" references the Game Action performed by the previous
 *   instruction (359.3.e.14 calls these linked instructions, and 359.3.e.14.b
 *   makes "if you do" directly reference that action: if the kill is replaced
 *   or never happens, the later instruction must not execute). It is modeled as
 *   a linked instruction for exactly that reason; an unconditional Draw 1 would
 *   be an approximation of the opposite failure mode.
 * - The merged effect.damage primitive links only `dealt`, `dealtTo` and
 *   `dealtCount`; it never reports lethal damage. A kill caused by damage is
 *   attributed by the cleanup/event pipeline (429.1.a.2 describes passive kill
 *   via Lethal Damage in a Cleanup; 429.5.c attributes it to the spell), and the
 *   reference kernel used by the merged tests does not run that cleanup for
 *   effect damage at all: after 3 damage a 3-Might unit is still on the board
 *   with damage 3 (golden-pinned), so no kill is produced for the condition to read.
 * - A condition predicate does now exist (RIFT-359 added condition.result and
 *   the interpreter resolves an instruction's link by instruction id + key: the
 *   golden shows `{ kind: "result", result: "disintegrate.deal-3", key: "dealt" }`
 *   evaluating true after a real link). What is still missing is a **producer**
 *   for the `killed` key: effect.damage never links it and nothing attributes
 *   lethal damage to the instruction, so the same predicate form with
 *   `key: "killed"` throws MissingInformation and the draw is ignored (contract
 *   3.4: 缺信息 → ignored, 不伪造 0). The card therefore fails closed instead of
 *   drawing unconditionally.
 *
 * Dependency: a condition.result producer plus lethal-damage→kill attribution
 * in the cleanup and event pipeline (429.5.c). The battlefield-restricted
 * target is already expressible in the card IR.
 */
const disintegrate = {
  canonicalCardId: "card.hash-59023abea680c1ec0358c2f407d08193931447ee6c2b18ad3f0a0588b4f6501f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「If this kills it」需要的结果条件本身已可由 RIFT-359 的 condition.result 表达" +
    "（golden 实测：effect.damage 之后读取 { result: \"disintegrate.deal-3\", key: \"dealt\" } 求值为 true），" +
    "当前唯一缺口是 killed 键没有生产者：effect.damage 只链接 dealt / dealtTo / dealtCount，" +
    "从不报告伤害是否致命；伤害造成的消灭归因（429.5.c）与死亡时点属于清理与事件管线，" +
    "参考内核在 effect damage 后不触发该清理（golden 实测：3 点伤害打在 3 Might 单位上后它仍在场上、damage=3），" +
    "因此没有把消灭归因回写到该指令的结果绑定。" +
    "同一谓词形态读取 key: \"killed\" 时抛 MissingInformation，解释器按契约 3.4 以缺信息 ignored 处理" +
    "（359.3.e.14.b：未发生/被替代就不能执行），失败关闭，不会退化成无条件 Draw 1，golden 固定该行为。",
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
