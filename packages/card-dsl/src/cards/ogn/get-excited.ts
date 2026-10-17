import type { CardProgram } from "../../ir/index.js";

/**
 * Get Excited! (ogn-008-298) — Spell, 2 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Discard 1. Deal its Energy cost as damage to a unit at a battlefield.
 *   (Ignore its Power cost.)
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 2, power 1 (Fury), might null, tags [].
 *
 * Status: judge-required. "Discard 1." is executable; the linked characteristic
 * read is not:
 * - "Deal its Energy cost as damage" reads a characteristic of the card that the
 *   previous instruction discarded. The object is produced by effect.discard,
 *   whose result links the discarded cards (423.1). Since the card changed zones,
 *   the read also relies on 359.3.e.13 (a spell that moves something as an effect
 *   can look back at its characteristics before the zone change).
 * - effect.discard writes a named result as
 *   `get-excited.discard-1.discarded`, whose value is
 *   `{ count, player, objects }`. The `{ linked: "get-excited.discard-1" }`
 *   ObjectSelector names only the producer instruction, and the current
 *   interpreter does not expose that nested `discarded.objects` binding through
 *   the selector. The characteristic read therefore has no object and the
 *   damage instruction is ignored as missing information (verified by the
 *   full-body probe below). Hard-coding the value would invent a card the
 *   player has not discarded yet, which the task's red lines forbid.
 * The program keeps the full intended shape (discard → linked characteristic
 * read → targeted damage) so the card can be completed once the selector
 * plumbing exists. "(Ignore its Power cost.)" is honored by never reading the
 * Power characteristic.
 *
 * Direct references already carry last-known characteristics after a zone
 * change; the remaining dependency is contract/interpreter support for a
 * linked ObjectSelector to consume a producer's named nested result binding.
 */
const getExcited = {
  canonicalCardId: "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Deal its Energy cost as damage」需要在结算时读取被弃牌张的印刷 Energy 费（206；359.3.e.13 的 look-back）。" +
    "effect.discard 实际写入的是 instructionId.discarded 这种命名结果（值为 {count, player, objects}），" +
    "而 amount 的 {linked: instructionId} 只按指令 ID 查找；当前解释器不会把嵌套的 discarded.objects 提取为 ObjectRef，" +
    "所以 characteristic read 没有对象，该读取按缺信息 ignored（实测该伤害指令返回 ignored/mistargeted 且不造成伤害）。" +
    "若改写为常量则等于预先硬编码一张尚未被弃的牌，属于禁止的近似实现。当前解释器的" +
    "仍缺 linked ObjectSelector 对生产者命名嵌套结果的消费接线；直接 ObjectRef 的离区后 last-known read 已支持。" +
    "Discard 1 部分仅用已合入的 effect.discard，有 golden 执行测试；「Ignore its Power cost」体现为完全不读取 Power 特征。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Discard 1. Deal its Energy cost as damage to a unit at a battlefield. (Ignore its Power cost.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (energy 2 + 1 Fury power) comes from the catalog; 206 /
      // 204.1 make the printed cost authoritative for cost checks.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "get-excited.discard-1",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // "Deal its Energy cost as damage to a unit at a battlefield." The
          // linked instruction reads the discarded card's printed Energy cost
          // and never its Power cost (printed reminder). The selector shape is
          // authored per contract 3.6; resolving it to the producer's discarded
          // reference is the missing piece (see judgeReason).
          id: "get-excited.deal-energy-cost",
          op: "effect.damage",
          linkedTo: "get-excited.discard-1",
          args: {
            amount: {
              kind: "object-property",
              object: { linked: "get-excited.discard-1" },
              property: "energy"
            },
            target: { kind: "constant", value: "get-excited.unit-at-battlefield" }
          },
          targets: [
            {
              id: "get-excited.unit-at-battlefield",
              filter: { type: "unit", zone: "board" },
              location: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default getExcited;
