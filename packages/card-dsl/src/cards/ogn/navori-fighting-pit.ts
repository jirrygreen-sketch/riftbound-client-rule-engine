import type { CardProgram } from "../../ir/index.js";

/**
 * Navori Fighting Pit (ogn-283-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-283-298):
 *   "When you hold here, buff a unit here. (If it doesn't have a buff, it gets
 *    a +1 :rb_might: buff.)"
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1: "When you hold here …" is a Hold Effect — a
 *   Triggered Ability whose Condition includes a unit being present at that
 *   Battlefield. The closed `hold` timing point (471.2, 473.2.b) is the one
 *   scoring/ is meant to emit.
 * - 355.5 / 355.7: "buff a unit here" names one Game Object to affect, so it
 *   is a target locked while the ability is finalized (not a resolution pick).
 * - "here" is the source Battlefield's location; the static IR expresses it
 *   with the frozen `sameLocationAs` anchor (contract 3.6) pointing at
 *   `"self"`, which the interpreter resolves to the ability host. No runtime
 *   ObjectRef is written into the program.
 * - 702.2.a / 702.3.a: to Buff a Unit a player places one Buff counter, and a
 *   second Buff on the same Unit is not placed. effect.buff (mode "buff")
 *   implements exactly that action; the +1 Might per Buff is 703 (layers).
 *
 * Status: judge-required — after the RIFT-270 audit the `hold` point is
 * emitted (turn/flow.ts's scoring wave emits the method point plus `score`),
 * but the trigger still cannot run in production: the EventPattern vocabulary
 * and target translator do not yet bind the `here` placeholder and
 * `sameLocationAs` to the scoring payload's battlefield identity (RIFT-357),
 * and Layers do not yet derive the +1 Might per Buff of 703 (the layer engine
 * keeps the buffs counter but evaluates printed Might). The body only uses
 * merged primitives and is executed by the golden test against the reference
 * kernel.
 */
const navoriFightingPit = {
  canonicalCardId: "card.hash-546a7aea49dffb7a5d50977e6011ab55e4c623b1ff68083db798c52197395627",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 RIFT-270 后时点产生方已就绪：hold 由 turn/flow.ts 的计分波（471.2/473.2.b，CR 383.4.d）在唯一事件管线发出；" +
    "但触发仍无法生产化，缺口不近似实现：" +
    "(1) 触发 filter 里的 here=true 与目标的 sameLocationAs:self 都是等待位置适配器绑定的占位键，" +
    "需要把注册源战场绑定为 scoring details.battlefieldId 过滤（RIFT-357）；" +
    "(2) 703 的 Buff → +1 Might 推导未实现：已验证 LayerEngine 对 buffs=1 的单位仍按印刷 Might 求值（buffs 计数器单独存在）；" +
    "能力本体只用已合入的 effect.buff 原语，位置锚点用契约 3.6 的 sameLocationAs: \"self\"，均由 golden 真实执行。",
  sourceText: "When you hold here, buff a unit here. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" marks the source-Battlefield restriction; it stays until the
        // scoring payload exposes the held battlefield (see judgeReason).
        filter: { event: "hold", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "navori.buff-unit-here",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "navori.unit-here" }
          },
          targets: [
            {
              id: "navori.unit-here",
              // "a unit here": any unit at this Battlefield (no controller
              // restriction), anchored to the source location (355.9.b).
              filter: { type: "unit", zone: "board", sameLocationAs: "self" },
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

export default navoriFightingPit;
