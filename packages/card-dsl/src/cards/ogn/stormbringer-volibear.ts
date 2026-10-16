import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-250-298 Stormbringer, Volibear (Spell, Fury/Body, 6 energy + 2 power,
 * tags Volibear / Signature) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Fury", "Body"], energy 6, power 2, might null.
 *
 * Printed text:
 *   Choose a friendly unit in your base. Deal damage equal to its Might to all
 *   enemy units at a battlefield, then move your unit there.
 *
 * Status: judge-required. Two parts of the clause cannot be expressed with the
 * merged primitives:
 * - "all enemy units at a battlefield" does NOT target the units: 355.10.b/355.10.d
 *   ("Kill all units at a battlefield" targets a battlefield, but not any units)
 *   make the BATTLEFIELD the targeted choice, and every enemy unit there is then
 *   affected without a choice. The merged target plan only resolves collections of
 *   board objects with per-member filters (`query` + min/max); it has no battlefield
 *   target and no derived "all objects at the chosen location" affected set, so the
 *   battlefield choice and its dependent unit set cannot be expressed or verified.
 * - "then move your unit there" needs that chosen battlefield: the destination is
 *   not a static LocationRef, not "controller-base", and not a static choice list,
 *   so no merged value/Expr can feed effect.move's `to`.
 * Expressible and covered by real tests: the chosen unit is a normal target
 * (355.7, in your Base, a public zone), and its Might is read at resolution via
 * `object-property` over that target (contract 3.2 Expr); damage is dealt by the
 * spell itself, which is the default source when the text does not name one
 * (418.6.a).
 */
const stormbringer = {
  canonicalCardId: "card.hash-0ff7c0201c85564ecdaf790021fc4115874fec7665a462b27901498984988f3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺战场目标与派生受影响集合：按 355.10.b/355.10.d，'all enemy units at a battlefield' 的目标是**战场**而非各单位" +
    "（CR 原文 \"Kill all units at a battlefield\" targets a battlefield, but not any units），选定战场后其上的敌人全部受影响；" +
    "target-plan 只按 query + min/max 处理场上对象集合，既没有战场目标，也没有「按所选地点派生对象集合」的表示；" +
    "'then move your unit there' 的 to 需要引用该已选战场的 LocationRef，" +
    "effect.move 的 to 只接受静态 LocationRef/controller-base/静态选项列表，没有 Expr 能取分组位置。" +
    "「其上等于其 Might 的伤害」与「选择我方基地单位」已用 object-property + effect.damage 表达并有执行测试。" +
    "依赖：RIFT-90 目标计划（战场目标/位置）与 RIFT-9 target.location；不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Choose a friendly unit in your base. Deal damage equal to its Might
          // to all enemy units at a battlefield." The amount reads the chosen
          // unit's Might at resolution time. Per 355.10.b/355.10.d the targeted
          // choice is the BATTLEFIELD ("Kill all units at a battlefield" targets a
          // battlefield, but not any units); the enemy units are a derived set
          // computed from that chosen location, which is the pending support.
          id: "stormbringer-damage",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "stormbringer-unit" },
              property: "might"
            },
            // "all enemy units at the chosen battlefield", pending target.location
            // support (RIFT-9 / RIFT-90).
            appliesTo: {
              kind: "literal",
              value: {
                filter: { type: "unit", controller: "opponent" },
                location: { target: "stormbringer-battlefield" }
              }
            }
          },
          targets: [
            {
              id: "stormbringer-unit",
              filter: { type: "unit", controller: "controller", locationType: "base" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "stormbringer-battlefield",
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then move your unit there" — effect.move is the intended
          // primitive, but `to` needs the chosen battlefield's LocationRef and no
          // merged Expr reads a target's location (see judgeReason).
          id: "stormbringer-move",
          op: "effect.move",
          linkedTo: "stormbringer-damage",
          args: {
            objects: { kind: "literal", value: { target: "stormbringer-unit" } },
            to: { kind: "literal", value: { locationOf: { target: "stormbringer-battlefield" } } },
            amount: { kind: "literal", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose a friendly unit in your base. Deal damage equal to its Might to all enemy " +
    "units at a battlefield, then move your unit there."
} satisfies CardProgram;

export default stormbringer;
