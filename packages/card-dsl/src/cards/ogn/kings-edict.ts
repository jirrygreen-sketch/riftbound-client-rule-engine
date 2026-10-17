import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-237-298 King's Edict (Spell, Order, 6 energy + 2 Order power) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Order"], energy 6, power 2, might null.
 *
 * Printed text:
 *   Starting with the next player, each other player chooses a unit you don't
 *   control that hasn't been chosen for this spell. Kill those units.
 *
 * Status: judge-required. The instruction is not expressible with merged
 * primitives, and the missing pieces are rules-level, not cosmetic:
 * - the choosers are the OTHER players, in turn order starting with the next
 *   player. `ResolveContext.choose` (contract 3.6) asks one chooser per request
 *   and the card cannot name runtime player ids; the merged interpreter control
 *   nodes are choice.optional / choice.mode / choice.order only, all with
 *   static chooser ids, and events/pipeline.ts turnOrder is engine-internal. No
 *   merged primitive or control node iterates "each other player" in turn order
 *   (355.18 leaves these resolution-time choices to the engine).
 * - "that hasn't been chosen for this spell" is a per-spell memory across the
 *   other players' choices; no primitive exposes a set that accumulates the
 *   previous choosers' picks, and the IR has no per-spell exclusion set.
 * - the victims are chosen by the opponents while the spell resolves, so they
 *   are NOT targeted (355.10.e: "It is part of a set of objects chosen in whole
 *   or in part by other players"), i.e. `picks`, not a TargetSpec (355.7/3.6).
 * The structure below records the intended shape; the kill half itself is the
 * merged effect.kill primitive and is covered by a real primitive test.
 */
const kingsEdict = {
  canonicalCardId: "card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺多玩家顺序选择原语：chooser 是「从下一位玩家开始，每个其他玩家」，" +
    "契约 3.6 的 choose 只支持单个 chooser；合并解释器只有 choice.optional/choice.mode/choice.order 三个控制节点，" +
    "chooser 都是静态 id，events/pipeline.ts 的 turnOrder 是引擎内部状态，无法按回合顺序遍历其他玩家；" +
    "「hasn't been chosen for this spell」需要跨选择累计的在本法术内排除集合，当前没有原语或 IR 记录它；" +
    "被选单位由对手在结算时选择，按 355.10.e 不是 target 而是 pick。" +
    "effect.kill（含 picks 来源）已合入并有执行测试；依赖：多玩家选择协调原语（RIFT-9 的 target.player 原型）" +
    "与 RIFT-90 目标计划；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Starting with the next player, each other player chooses a unit you
          // don't control that hasn't been chosen for this spell." The chooser
          // order, the chooser set and the per-spell exclusion are the pending
          // primitive's payload; the chosen objects are picks, not targets.
          id: "kings-edict-choose",
          op: "choice.each-other-player",
          args: {
            startingWith: { kind: "literal", value: "next-player" },
            choosers: { kind: "literal", value: "each-other-player" },
            setKey: { kind: "literal", value: "kings-edict-chosen" },
            choose: {
              kind: "literal",
              value: {
                type: "unit",
                controller: "opponent",
                notChosenForThisSpell: true
              }
            }
          }
        },
        {
          // "Kill those units." — merged effect.kill consuming the units the
          // other players chose (non-target picks).
          id: "kings-edict-kill",
          op: "effect.kill",
          linkedTo: "kings-edict-choose",
          args: { picks: { kind: "literal", value: "kings-edict-units" } },
          picks: [
            {
              id: "kings-edict-units",
              options: ["dynamic:units-chosen-for-this-spell"],
              min: 0,
              max: null,
              selection: "any",
              filter: { type: "unit", controller: "opponent" }
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Starting with the next player, each other player chooses a unit you don't control " +
    "that hasn't been chosen for this spell. Kill those units."
} satisfies CardProgram;

export default kingsEdict;
