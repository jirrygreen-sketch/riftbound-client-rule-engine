import type { CardProgram } from "../../ir/index.js";

/**
 * First Mate (ogn-132-298) — Unit, 3 energy, no printed power (Body), 3 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-132-298):
 *   When you play me, ready another unit.
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：打出触发（420.4.a 打出完成后触发；时点 card-played 由
 *   chain/engine.ts 在链项结算时发出），filter 指向自身。
 * - “ready another unit”：重置一个单位（416.1，effect.ready）。
 *   “another” 排除来源本身（355.7 的目标选择；“me”/其他指代见 053、053.1）；
 *   350.2 的「另一个」在目标过滤里用已支持的 `exclude: "self"` 锚点表达，
 *   Finalize/Resolve 由目标管线排除来源对象。
 * - “a unit” 不限控制者：英文原文没有 “friendly”，目标可以是任意一方的单位
 *   （740.1.a/740.1.b 只在文本出现 friendly/enemy 时适用），故 filter 不写 controller。
 *
 * status: judge-required —— `exclude: "self"` 已能表达 another unit，effect.ready
 * 本体也已合入；仍缺 card-played 时点到卡牌程序触发能力的绑定（RIFT-257）。
 * 效果本体 effect.ready 已合入，golden 测试以真实原语执行 body 的目标形态。
 */
export default {
  canonicalCardId: "card.hash-13c281a3bc1e1968da6243959de3a79839c9799f34c472de4e7356dacdbc9078",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.ready 本体与 `exclude: \"self\"` 的 another unit 目标过滤已合入；仍缺 card-played 时点到卡牌程序触发能力的绑定（RIFT-257），" +
    "因此触发链尚未形成完整执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "first-mate.ready",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "first-mate.other-unit" } }
          },
          targets: [
            {
              id: "first-mate.other-unit",
              filter: { type: "unit", zone: "board", exclude: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, ready another unit."
} satisfies CardProgram;
