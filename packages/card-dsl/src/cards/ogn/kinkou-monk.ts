import type { CardProgram } from "../../ir/index.js";

/**
 * Kinkou Monk (ogn-141-298) — Unit, 4 energy, 1 power (Body), 4 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-141-298):
 *   When you play me, buff up to two other friendly units. (Each one that
 *   doesn't have a buff gets a +1 :rb_might: buff.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：打出触发（420.4.a；时点 card-played），filter 指向自身。
 * - “buff up to two other friendly units”：选择具体游戏对象 → 是目标（355.7）。
 *   “up to two” 允许 0..2（355.13），故 TargetSpec 用 selection "up-to"、min 0、max 2。
 *   “other friendly” 由过滤器的 controller="controller" + other:true 表达；
 *   “another / 其他” 排除来源对象（740.1.a 定义 friendly，053.1 的自我指称）。
 * - effect.buff（702.2.a 放置 buff counter；702.3/702.3.a 已有 buff 时不放置；
 *   原语自身的 chooseUpTo 文档以本卡为例，但目标已在 Finalize 由 TargetSpec 选好，
 *   故这里不再叠加运行期二次选择）。
 *
 * status: judge-required —— `other` 的排除语义无可执行路径：
 * 已合入的 target/target-plan.ts 与解释器 prepareTargets 都不识别过滤器里的
 * `other` 键（只按 zone/type/controller 等做匹配），因此“other friendly units”
 * 目前既不能排除来源、也不能被真实管线验证（355.7 的目标选择限制），依赖 RIFT-90
 * 目标系统；card-played 时点由 chain/engine.ts 发射，尚未接线到 game-server。
 * effect.buff 本体已合入，golden 测试以真实原语执行 body 的目标形态。
 */
export default {
  canonicalCardId: "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.buff 本体已合入（702.2.a/702.3.a，原语文档也以本卡为例），但「up to two other friendly units」的" +
    "目标限制没有可执行路径：已合入的 target/target-plan.ts 与解释器 prepareTargets 都不识别过滤器 `other` 键，" +
    "无法排除来源对象，`up-to` 的 0..2 上限也只在解释器的 choose 路径上生效而未经目标系统验证（355.7/355.13）；" +
    "依赖 RIFT-90 目标系统。另：card-played 时点由 chain/engine.ts 发射，引擎批 4 尚未接线到 game-server。" +
    "不近似实现（不把 `other` 当作已生效）。",
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
          id: "kinkou.buff-up-to-two",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "kinkou.other-friendly-units" }
          },
          targets: [
            {
              id: "kinkou.other-friendly-units",
              filter: { type: "unit", zone: "board", controller: "controller", other: true },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play me, buff up to two other friendly units. (Each one that doesn't have a buff gets a +1 :rb_might: buff.)"
} satisfies CardProgram;
