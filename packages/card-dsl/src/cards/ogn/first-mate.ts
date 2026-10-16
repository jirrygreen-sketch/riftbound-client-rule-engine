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
 *   350.2 的「另一个」在目标过滤里用契约层已有的 `other: true` 占位键表达
 *   （与 ogn/pit-rookie.ts、sfd/bubble-bot.ts 同一写法），Finalize/Resolve 由目标管线
 *   解析该键并排除来源对象。
 * - “a unit” 不限控制者：英文原文没有 “friendly”，目标可以是任意一方的单位
 *   （740.1.a/740.1.b 只在文本出现 friendly/enemy 时适用），故 filter 不写 controller。
 *
 * status: judge-required —— 每条依赖逐项核对：
 * 1. `other: true` 的解析（把来源对象排除出候选集合）属于目标管线：已合入的
 *    target/target-plan.ts 只按 ObjectFilter 做 `matchesRequirement` 的地点判定，
 *    解释器 prepareTargets 也只按 filter 做 ctx.query，二者都不识别 `other`；
 *    因此“another”目前无法被真实管线排除（依赖 RIFT-90 目标系统）。
 * 2. card-played 时点的发射方（chain/engine.ts）属引擎批 4，尚未接线到 game-server；
 *    触发在真实内核中不可达。
 * 效果本体 effect.ready 已合入，golden 测试以真实原语执行 body 的目标形态。
 */
export default {
  canonicalCardId: "card.hash-13c281a3bc1e1968da6243959de3a79839c9799f34c472de4e7356dacdbc9078",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.ready 本体已合入，但「another unit」的排除语义无可执行路径：已合入的 target/target-plan.ts " +
    "与解释器 prepareTargets 都不识别过滤器的 `other` 键（只按 zone/type 等做匹配），无法把来源对象排除；" +
    "「another」属目标选择限制（355.7），依赖 RIFT-90 目标系统落地。另：card-played 时点由 chain/engine.ts " +
    "发射，引擎批 4 尚未接线到 game-server，触发在真实内核中不可达。不近似实现（不把 `other` 当作已生效）。",
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
              filter: { type: "unit", zone: "board", other: true },
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
