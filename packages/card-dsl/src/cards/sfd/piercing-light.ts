import type { CardProgram } from "../../ir/index.js";

/**
 * Piercing Light (sfd-023-221) — Spell, 2 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Repeat] :rb_energy_2::rb_rune_fury: (You may pay the additional cost to
 *   repeat this spell's effect.)
 *   Deal 2 to a unit at a battlefield, then deal 2 to up to one other unit.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-023-221):
 * cardType Spell, domains ["Fury"], energy 2, power 1, might null, tags [].
 * The printed ability line carries no [Action]/[Reaction]/[Hidden] keyword, so
 * the spell keeps its default timing (159.2) and no speed keyword is declared.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Repeat] (820) is an Optional Additional Cost keyword. 820.1.c formats it
 *   "Repeat [Cost]", 820.1.c.1 makes the cost an Additional Cost paid during the
 *   steps of playing the spell, and 820.1.d.1 has each paid instance execute the
 *   spell's effect one additional time during resolution, with the choices
 *   re-made (820.2 / 820.2.a). The printed additional cost (2 Energy + 1 Fury
 *   power) is declared on the play ability's CostSpec with an explicit
 *   pay/decline choice, exactly the shape the merged Frigid Touch (sfd-066-221)
 *   uses while the Repeat keyword has no card-to-cost wiring.
 * - "Deal 2 to a unit at a battlefield" is a Choice in a Public zone, so the
 *   unit is Targeted (355.5, 355.7, 355.10.a); "at a battlefield" restricts that
 *   unit and does not target a battlefield (355.10.b), carried as the
 *   TargetSpec's `location`. The merged `effect.damage` submits the Deal action
 *   (418.1.b/c).
 * - "then deal 2 to up to one other unit" is a second, independent sentence
 *   joined by "then" (359.3.e.11: resolve as much as possible when the sentences
 *   are not linked by a reference). "up to one" may choose zero or one
 *   (355.13), so its TargetSpec is `selection: "up-to"` with min 0; "another"
 *   excludes the unit chosen by the first sentence (355.9.c, 740.1.a), which the
 *   merged `exclude` anchor expresses with the first TargetSpec as its object
 *   selector. The second TargetSpec is declared on a separate instruction, so
 *   both units are chosen and locked with the spell (355.8) yet neither
 *   instruction references the other's action (359.3.e.14).
 *
 * Status: judge-required（2026-10-18 逐条对源码复核）, with each gap named:
 * - the [Repeat] payment cannot be charged or read back (820.1.c.1 / 820.1.d.1):
 *   programs/play.ts translateCost rejects `kind: "additional"` and the
 *   `optional` field, so no merged code turns this card's declared optional
 *   additional cost into the planner's `optionalAdditional` input (the planner
 *   itself accepts one and really charges it). The paid instance count also has
 *   no card-side route into the interpreter's repeat node: the receipt reads as
 *   a boolean `result: "cost.optional-additional-paid"` while the repeat node
 *   requires a non-negative integer count.
 * - the second TargetSpec's `exclude` anchor does not bind: the merged
 *   interpreter consumes the anchor (interpreter/selectors.ts queryObjects
 *   handles `exclude`), but programs/filters.ts translateObjectFilter rejects
 *   the key outright ("Unsupported filter field exclude"), so describePlay
 *   fails before any Finalize mapping exists. The zero-choice path itself is
 *   merged end to end (explicit Finalize selection and the interpreter both
 *   accept an empty `up-to` set).
 * Both Deal instructions use merged primitives with Finalize-locked targets, and
 * the golden test executes them (including the zero-choice and stale-target
 * cases) through the real interpreter and reference kernel. Nothing is
 * approximated: the amounts are the printed 2s and neither unit is dropped.
 */
export default {
  canonicalCardId: "card.hash-c6895a694724e94fb577d7753bb9ddc8cb6e91662ff6c79fdcad9ae7755438ff",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) [Repeat] :rb_energy_2::rb_rune_fury: 的可选附加费用无法收取或回读：没有把卡牌程序声明的" +
    "可选附加费用接进已合入 cost 计划的 optionalAdditional 入口（费用计划本身接受该组件并真实扣费），" +
    "已付实例数也没有供结算读取的绑定：programs/play.ts 的 translateCost 实测拒绝 kind additional 与 optional 字段；" +
    "付费回执只能由 condition.predicate 的 result: \"cost.optional-additional-paid\" 读成布尔值，" +
    "而解释器 repeat 节点只接受非负整数（实测 \"Repeat count must be a non-negative safe integer\"）（820.1.c.1 / 820.1.d.1）。" +
    "(2) 第二个目标的 exclude 锚点在生产绑定层被拒：解释器已消费该锚点（interpreter/selectors.ts 的 queryObjects），" +
    "但 programs/filters.ts 的 translateObjectFilter 实测抛 \"Unsupported filter field exclude\"，describePlay 在 Finalize 之前就失败。" +
    "第二个目标按 355.13 允许『up to one』选 0 个（selection: up-to、min: 0），该零选择路径已端到端合入" +
    "（Finalize 显式 selected 集与解释器都接受空 up-to 集，golden 已覆盖）。两条 effect.damage 数额、目标限制（355.10.b 的 location、355.9.c/740.1.a 的" +
    "『another』经 exclude 锚点排除首个目标）与 355.8 的锁定形状已如实编码，golden 用真实原语执行（含零选择与 stale 目标边界）。" +
    "依赖：Repeat 可选附加费用 → Finalize 接线与实例数入口、programs/filters.ts 的 exclude 锚点绑定。",
  abilities: [
    {
      kind: "play",
      // [Repeat] :rb_energy_2::rb_rune_fury: (820.1.c): the printed additional cost
      // is declared with the pay/decline choice 820.1.b requires. Its consumer is
      // the cost plan's optionalAdditional wiring; no merged code reads it today,
      // which is part of
      // judgeReason. The printed base cost (2 Energy + 1 Fury power) comes from
      // the catalog.
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            // 820.1.b: paying is optional, so the payment carries the explicit
            // pay/decline decision (355.1.a makes it a step-2 choice).
            choice: {
              id: "piercing-light.repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          },
          {
            // :rb_rune_fury: is the Fury part of the printed additional cost
            // (820.1.c); 820.1.c.1 keeps it an Additional Cost to this spell.
            kind: "power",
            amount: { kind: "constant", value: 1 },
            allowedDomains: ["Fury"]
          }
        ]
      },
      body: [
        {
          // "Deal 2 to a unit at a battlefield" (418.1.b/c).
          id: "piercing-light.deal-2-first",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "piercing-light.battlefield-unit" }
          },
          targets: [
            {
              id: "piercing-light.battlefield-unit",
              filter: { type: "unit", zone: "board" },
              // 355.10.b: "at a battlefield" restricts the unit; the merged
              // target system reads this as TargetRequirement.location.
              location: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then deal 2 to up to one other unit" — a separate sentence
          // (359.3.e.11), so it is not linked to the first Deal; "up to one"
          // allows zero choices (355.13) and "other" excludes the first
          // sentence's unit (355.9.c, 740.1.a).
          id: "piercing-light.deal-2-second",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "piercing-light.other-unit" }
          },
          targets: [
            {
              id: "piercing-light.other-unit",
              filter: {
                type: "unit",
                zone: "board",
                exclude: { target: "piercing-light.battlefield-unit" }
              },
              min: 0,
              max: 1,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] :rb_energy_2::rb_rune_fury: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Deal 2 to a unit at a battlefield, then deal 2 to up to one other unit."
} satisfies CardProgram;
