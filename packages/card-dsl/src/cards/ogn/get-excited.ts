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
 * - A characteristic read resolves through a contract 3.6 object selector.
 *   The current interpreter records effect.discard's object link, but the
 *   linked ObjectSelector still cannot carry the discarded card's last-known
 *   snapshot into this characteristic read after the zone change. The
 *   object-valued selection is therefore missing and the read is ignored as
 *   missing information (verified by probe; the damage instruction reports
 *   ignored/mistargeted and no damage is dealt). Hard-coding the value instead
 *   would invent a card the player has not discarded yet, which the task's
 *   red lines forbid.
 * - The IR can spell the prior instruction's linked result, but the current
 *   interpreter still cannot carry the discarded card's last-known snapshot
 *   through this linked ObjectSelector for the characteristic read. The
 *   resulting amount is missing and the damage instruction is ignored, so the
 *   card remains judge-required rather than hard-coding a value.
 * The program keeps the full intended shape (discard → linked characteristic
 * read → targeted damage) so the card can be completed once the selector
 * plumbing exists. "(Ignore its Power cost.)" is honored by never reading the
 * Power characteristic.
 *
 * Dependency: contract-level support for a linked object selector that reads a
 * producer's named result binding, so a
 * characteristic read can consume effect.discard's discarded reference, plus the
 * printed-cost lookup (206).
 */
const getExcited = {
  canonicalCardId: "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Deal its Energy cost as damage」需要在结算时读取被弃牌张的印刷 Energy 费（206；359.3.e.13 的 look-back）。" +
    "契约 3.6 的 linked ObjectSelector 虽然能读取 effect.discard 的对象链接，但当前解释器不能把已离区对象的 last-known snapshot" +
    "带入该 characteristic read —— 对象值缺失，该读取按缺信息 ignored（实测该伤害指令返回 ignored/mistargeted 且不造成伤害）。" +
    "若改写为常量则等于预先硬编码一张尚未被弃的牌，属于禁止的近似实现。当前解释器的" +
    "链接 ObjectSelector 不能把 effect.discard 的已离区对象与可回溯的 characteristic read 联合消费，" +
    "因此该读取缺信息并使伤害被忽略。依赖：effect.discard 的对象链接与离区后 last-known characteristic read 的执行接线，" +
    "以及印刷费用读取（206）。Discard 1 部分仅用已合入的 effect.discard，有 golden 执行测试；「Ignore its Power cost」体现为完全不读取 Power 特征。",
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
