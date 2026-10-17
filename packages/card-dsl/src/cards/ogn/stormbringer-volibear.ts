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
 * Status: judge-required. "all enemy units at a battlefield" still cannot be
 * expressed and is not approximated:
 * - the units are NOT targeted: 355.10.b/355.10.d ("Kill all units at a
 *   battlefield" targets a battlefield, but not any units) make the BATTLEFIELD
 *   the targeted choice, and every enemy unit there is then affected without a
 *   choice. effect.damage consumes only a TargetSpec id, and the merged target
 *   plan resolves collections of board objects with per-member filters; there is
 *   no non-target "all objects at the chosen location" affected set for the
 *   damage primitive, so the battlefield choice plus its derived unit set cannot
 *   be executed. Declaring the units as a TargetSpec would violate 355.10.b.
 * Expressible and covered by real tests: the chosen unit is a normal target
 * (355.7, in your Base, a public zone), and its Might is read at resolution via
 * `object-property` over that target (contract 3.2 Expr); damage is dealt by the
 * spell itself, which is the default source when the text does not name one
 * (418.6.a).
 * "then move your unit there" executes on merged paths since RIFT-258: the
 * chosen battlefield's LocationRef is bound with `condition.value` over the
 * battlefield target (`object-property` "location") and read back as the linked
 * `to` destination of effect.move, which moves the chosen unit without a Move
 * cost or Main Phase gate (this is an effect Move, not the Standard Move).
 */
const stormbringer = {
  canonicalCardId: "card.hash-0ff7c0201c85564ecdaf790021fc4115874fec7665a462b27901498984988f3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺战场目标与派生受影响集合：按 355.10.b/355.10.d，'all enemy units at a battlefield' 的目标是**战场**而非各单位" +
    "（CR 原文 \"Kill all units at a battlefield\" targets a battlefield, but not any units），选定战场后其上的敌人全部受影响；" +
    "effect.damage 只接受 TargetSpec id（没有非目标的 query/集合形态），target-plan 也没有「按所选地点派生对象集合」的表示；" +
    "把单位写成 TargetSpec 会违反 355.10.b 并错误触发成为目标。" +
    "'then move your unit there' 已可执行（condition.value 绑定战场 LocationRef + effect.move 的 linked to），见 golden。" +
    "「其上等于其 Might 的伤害」的取值表达式与「选择我方基地单位」本身也已用 object-property + 目标表达并有执行测试，" +
    "唯独受影响集合无法执行，故整卡保持 judge-required。" +
    "依赖：355.10.b/355.10.d 的战场目标 + 派生集合消费方（RIFT-90 目标计划与 effect.damage 的非目标集合形态）；不近似实现。",
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
          // "then move your unit there" — the chosen battlefield's LocationRef
          // is bound once so the move's `to` can read it back as a linked value
          // (355.5.b: the choice is the battlefield; contract 3.9 binds values).
          // The battlefield TargetSpec stays declared once, on the damage
          // instruction above; this instruction re-reads the same locked choice.
          id: "stormbringer-battlefield-location",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: { target: "stormbringer-battlefield" },
              property: "location"
            },
            key: { kind: "constant", value: "battlefieldLocation" }
          }
        },
        {
          // "then move your unit there" — an effect Move to the chosen
          // battlefield (421/448-455), not the Standard Move: no exhaust cost
          // and no Main Phase gate. Not linkedTo the damage clause: the
          // anaphora refers to the chosen unit/battlefield, not to the damage
          // action, so a negated deal does not suppress the move (359.3.e.14).
          id: "stormbringer-move",
          op: "effect.move",
          args: {
            objects: { kind: "literal", value: { target: "stormbringer-unit" } },
            to: {
              kind: "linked-value",
              instructionId: "stormbringer-battlefield-location",
              key: "battlefieldLocation"
            },
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
