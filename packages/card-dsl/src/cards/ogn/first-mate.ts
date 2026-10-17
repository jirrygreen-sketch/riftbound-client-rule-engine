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
 * status: judge-required（2026-10-17 实测）。`exclude: "self"` 已能表达 another unit，
 * effect.ready 本体也已合入，但当前缺口有两处：
 * 1. 生产绑定器拒绝该 TargetSpec 字段：programs/filters.ts 的 translateObjectFilter
 *    对 `{ type: "unit", zone: "board", exclude: "self" }` 抛
 *    "Unsupported filter field exclude"，programs/triggers.ts 因此无法注册本卡触发
 *    （真实 attachLifecycle 实测 0 个触发注册），"another" 无法交给完整的
 *    Finalize/Resolve 目标管线（355.9.b、359.3.e.5）。
 * 2. 触发过滤器的锚点写法同样被拒：trigger.filter 的内层 `source: "self"` 会被
 *    translateTriggerFilter 转成 object.objectId，但 exclude 字段在第一步就已抛出。
 * effect.ready 本体已合入，golden 以真实原语 + 解释器执行 body 的目标形态。
 */
export default {
  canonicalCardId: "card.hash-13c281a3bc1e1968da6243959de3a79839c9799f34c472de4e7356dacdbc9078",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.ready 本体与 `exclude: \"self\"` 的 another unit 目标过滤已写入 IR，" +
    "但两处当前缺口未合入（均为 2026-10-17 实测）：" +
    "（1）programs/filters.ts 的 translateObjectFilter 不接受 exclude 字段，" +
    "对 \"{ type: \"unit\", zone: \"board\", exclude: \"self\" }\" 抛" +
    "「Unsupported filter field exclude」；programs/triggers.ts 因此无法注册本卡触发" +
    "（真实 attachLifecycle 实测注册 0 个触发）。" +
    "（2）「another」的完整语义需要 Finalize/Resolve 期按来源身份排除" +
    "（355.9.b、359.3.e.5），当前没有把这层排除接入目标管线的绑定。" +
    "effect.ready 的 416.1 本体与 \"a unit\" 不限控制者（740.1.a/740.1.b 未出现 friendly/enemy）已由 golden 执行。",
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
