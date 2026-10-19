import type { CardProgram } from "../../ir/index.js";

/**
 * Singularity — ogn-105-298 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   Deal 6 to each of up to two units.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 6, power 2 (Mind), might null. The
 * `null` Might is a printed absence of Might, not zero.
 *
 * Modeling notes (Core Rules v1.5):
 * - One play ability resolves through the default ProgramBinding -> ChainEngine
 *   path. Its printed base cost is declared as 6 Energy plus 2 Power of this
 *   card's Mind domain (CR 356.1.c / 357.1).
 * - One TargetSpec (damaged-units) selecting up to two units
 *   (selection "up-to", min 0, max 2). This is ordinary targeting, not
 *   damage splitting (355.14): the amount is a fixed 6 dealt to each target,
 *   so effect.damage submits one damage GameAction per still legal target
 *   (418.1.c) without divide.
 * - There is no speed keyword: spells default to Action timing (159.2.a),
 *   so no keyword ability is declared.
 */
const singularity = {
  canonicalCardId: "card.hash-10b7d5be25093a4d318efd8639b6e34583bad10bf38adbf93b4c3733ea54221b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前静态 IR 的 6 Energy + 2 Mind、0..2 unit target 与 effect.damage 已由 executableView 经" +
    " createProgramBinding -> ChainEngine 验证；但 P4 默认 Spell 服务（apps/game-server/src/duel/" +
    "p4-spell-services.ts 的 createP4SpellServices，且 authoritative-runtime-p4.ts:809 正在使用它）" +
    "只开放 draw-cards/kill-unit/kill-units/point-damage，没有 deal-damage port/closure，真实房间会在" +
    " Spell cost slice 前 fail closed。另，默认 programs/play.ts -> chain/engine.ts 路径不校验" +
    " source owner/actor，会接纳资源充足的非所有者（见本卡 golden 的 source-ownership TODO）。" +
    "需对应 engine-core/game-server owner 提供 source-owned deal-damage port 与 actor guard 后再恢复" +
    " executable；CR 309/312/337/339/355.5/358/359.3.e.8/418.1.c。",
  abilities: [
    {
      kind: "play",
      // Printed 6 Energy + 2 Mind Power from the catalog; Might stays absent.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "deal-6-each",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 6 },
            target: { kind: "constant", value: "damaged-units" }
          },
          targets: [
            {
              id: "damaged-units",
              filter: { types: "unit" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Deal 6 to each of up to two units."
} satisfies CardProgram;

export default singularity;
