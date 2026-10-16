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
 * Status: judge-required — the trigger cannot run in production because no
 * merged module emits the `hold` timing point into the single event pipeline
 * (see judgeReason). The body only uses merged primitives and is executed by
 * the golden test against the reference kernel.
 */
const navoriFightingPit = {
  canonicalCardId: "card.hash-546a7aea49dffb7a5d50977e6011ab55e4c623b1ff68083db798c52197395627",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺时点接线：\"When you hold here\" 依赖 hold 时点（CR 383.4.d、471.2、473.2.b）进入唯一事件管线，" +
    "但已合入代码没有任何模块 emit hold（chain/engine.ts 只 emit chain-item-*/cleanup-*/showdown-*/card-played/became-target 等自有节点），" +
    "engine-core/src/chain/SCENARIO-COVERAGE.md 的 triggers-hold-unit-present 亦标注未覆盖，" +
    "需 scoring/触发接线任务（RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers，及契约 §7.2 批 5）；" +
    "触发器 filter 里 here=true 是等待 scoring 载荷的占位键，当前管线会忽略；引擎侧 assertTriggerSpec 也会以 " +
    "\"EventPattern 不允许此字段\" 拒绝该占位键（golden 测试断言了这一点），因此本程序不可当作可运行触发器。" +
    "能力本体只用已合入的 effect.buff 原语，位置锚点用契约 3.6 的 sameLocationAs: \"self\"；" +
    "整卡在时点接线落地并复核前保持 judge-required，不近似实现。",
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
