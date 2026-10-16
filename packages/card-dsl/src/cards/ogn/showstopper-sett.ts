import type { CardProgram } from "../../ir/index.js";

/**
 * Showstopper, Sett (ogn-270-298) — Spell, 1 energy + 1 Body power
 * (Body/Order, Sett Signature).
 *
 * Printed text:
 *   Buff a friendly unit in your base, then move it to a battlefield.
 *   (If it doesn't have a buff, it gets a +1 :rb_might: buff.)
 *
 * Modeling notes (Core Rules v1.5):
 * - "Buff a friendly unit in your base" is the merged effect.buff primitive in
 *   "buff" mode: 702.2.a places one Buff counter on the chosen unit, while
 *   702.3 / 427.1.c keep a unit that already has a Buff a legal choice that
 *   simply is not buffed again. The reminder text restates exactly that
 *   behaviour, so it is not a separate instruction. "a friendly unit in your
 *   base" is a Choice (355.5 / 355.7).
 * - "then move it to a battlefield" moves that same unit as an effect Move,
 *   not the Standard Move ability (144, 451.1), so it neither exhausts nor
 *   charges the unit. "It" is the unit already chosen for the Buff, so the Move
 *   consumes the same Finalize-locked TargetSpec rather than making a second
 *   choice, and it is linked to the Buff instruction so a lost unit ignores the
 *   follow-up (contract 3.4 / CR 359.3.e).
 * - "to a battlefield" leaves the Destination to the controller among the
 *   runtime-legal Locations (355.4 / 355.4.a: a valid Location is one other
 *   than the unit's current Location where it is allowed to be present), which
 *   is the same Finalize-time choice the merged Charm (ogn-043-298) records as
 *   an enumerated-at-runtime placeholder.
 *
 * Status: judge-required — two expressions are missing:
 * - "in your base" cannot be restricted exactly. The merged location predicate
 *   only compares a location TYPE string ("base" / "battlefield", see
 *   layers/filter.ts) or an exact LocationRef, which needs the concrete
 *   player id; no merged predicate resolves a controller-relative base, and
 *   the type form would also admit a friendly unit sitting in an opponent's
 *   base. The intended restriction is authored with the descriptive key so it
 *   is reviewable and fail-closed.
 * - the Move Destination ("to a battlefield") cannot be enumerated: 355.4.a
 *   makes the Destination a Finalize-time choice among the runtime-legal
 *   Locations, but effect.move accepts a static LocationRef, the literal
 *   "controller-base", a static option list of LocationRefs, or an Expr the
 *   primitive itself evaluates; nothing can build that option list at
 *   Finalize from the runtime board. Not approximated with a fixed
 *   battlefield.
 * The Buff half uses only merged structures and is executed by the golden test;
 * the Move half is executed there with a caller-supplied Finalize Destination,
 * exactly as the production caller must supply it.
 */
const showstopper = {
  canonicalCardId: "card.hash-b22bcf86e002f1a9a45cb4011a53cb3377c815e03ab16283a99130fec4987f95",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处表达缺依赖：(1)「in your base」无法精确限制——已合入的位置谓词只按位置类型字符串（base/battlefield，" +
    "见 layers/filter.ts）或精确 LocationRef 比较，后者需要控制者的玩家 id，已合入代码没有“控制者自己的基地”谓词；" +
    "只写位置类型会把位于对手基地的己方单位也纳入，因此按描述性键写出（fail-closed，不近似）。" +
    "(2)「to a battlefield」的目的地无法枚举：355.4/355.4.a 要求移动效果在 Finalize 从运行时合法 Location 中选择，" +
    "而 effect.move 只接受静态 LocationRef、字面量 controller-base、静态候选列表，或其自身能求值的 Expr" +
    "（静态 ObjectSelector 只覆盖对象），战场目的地集合没有可写形态；不用固定战场近似。" +
    "Buff 半段（702.2.a/702.3/427.1.c）只用已合入的 effect.buff，由 golden 执行；" +
    "Move 半段在 golden 中按生产调用方必须提供的方式传入 Finalize 目的地执行。",
  sourceText:
    "Buff a friendly unit in your base, then move it to a battlefield. " +
    "(If it doesn't have a buff, it gets a +1 :rb_might: buff.)",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "buff-friendly-unit-in-base",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit-in-base" }
          },
          targets: [
            {
              id: "friendly-unit-in-base",
              // "a friendly unit in your base": one targeted unit (355.7).
              // "in your base" is the descriptive key below — the merged
              // location predicate cannot express the controller's own base
              // (see judgeReason).
              filter: { type: "unit", controller: "self", location: "base", locationPlayer: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "move-buffed-unit",
          op: "effect.move",
          linkedTo: "buff-friendly-unit-in-base",
          args: {
            // "then move it": the same Finalize-locked unit the Buff chose,
            // not a second selection.
            objects: { kind: "constant", value: { target: "friendly-unit-in-base" } },
            // "to a battlefield" — the Destination is a Finalize-time choice
            // among the runtime-legal Locations (355.4.a). The frozen IR
            // cannot enumerate them, so this is the merged Charm placeholder
            // shape: effect.move rejects it instead of inventing a battlefield.
            to: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "showstopper.destination",
                options: ["runtime:legal-battlefield-destination"]
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default showstopper;

