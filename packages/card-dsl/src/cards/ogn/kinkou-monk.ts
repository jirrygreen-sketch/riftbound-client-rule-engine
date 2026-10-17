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
 *   “up to two” 允许 0..2（355.13），故 TargetSpec 用 selection "up-to"、min 0、max 2；
 *   target/target-plan.ts 的 targetBounds 会按 355.13 校验 0..2。
 *   “other friendly” 由过滤器的 controller="self"（能力控制者，chain/engine.ts 归一化）
 *   加已合入的锚点 exclude: "self"（排除来源对象；contract 3.6 / README 第 3 节的对象
 *   选择器锚点，解释器的 queryObjects 会执行它）表达（740.1.a 定义 friendly，053.1 的
 *   自我指称）。
 * - effect.buff（702.2.a 放置 buff counter；702.3/702.3.a 已有 buff 时不放置；
 *   原语自身的 chooseUpTo 文档以本卡为例，但目标已在 Finalize 由 TargetSpec 选好，
 *   故这里不再叠加运行期二次选择）。
 *
 * status: judge-required（2026-10-17 复核）—— effect.buff 本体已合入，golden 以真实原语 +
 * 解释器执行 body 的目标形态与排除边界；仍缺的生产链路是两处已实测的 `exclude` 锚点缺口：
 * - programs/filters.ts 的 translateObjectFilter 在翻译注册的触发体时对 `exclude` 抛
 *   ProgramBindingError（judge-required，“Unsupported filter field exclude”），因此本卡触发
 *   经 createProgramBinding/registerProgramTriggers 注册时无法绑定；
 * - target/target-plan.ts 的 Finalize 候选查询走 context.query → layers/filter.ts，而
 *   matchesObjectFilter 不消费 OBJECT_FILTER_ANCHORS，来源自身会成为合法候选（355.7 的
 *   “other” 限制失效）；解释器在锁定目标重验时才会执行 exclude。“up to two” 的合法 0 选择
 *   仍依赖该候选集正确。
 * 依赖：CardProgram → TargetSpec 的 `exclude` 锚点绑定与 Finalize 候选查询对
 * OBJECT_FILTER_ANCHORS 的消费。不近似实现（不放行未知锚点，也不把 “other” 改成计数近似）。
 */
export default {
  canonicalCardId: "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.buff 本体已合入（702.2.a/702.3.a），解释器在锁定目标重验时也会执行 exclude（golden 已覆盖），" +
    "但仍有两处已实测的生产缺口：(1) programs/filters.ts 的 translateObjectFilter 在翻译注册触发体时对 " +
    "`exclude` 抛 ProgramBindingError（judge-required），本卡触发经 registerProgramTriggers 无法注册；" +
    "(2) Finalize 候选查询（target/target-plan.ts legalCandidates → context.query → layers/filter.ts 的 " +
    "matchesObjectFilter）不消费 OBJECT_FILTER_ANCHORS，来源自身会成为合法候选，“other friendly units” " +
    "（355.7）在 Finalize 阶段失效；该候选集也是 “up to two”（355.13）合法 0 选择的来源。" +
    "依赖：exclude 锚点的生产绑定与 Finalize 候选查询消费。不近似实现（不放行未知锚点、不用计数近似 “other”）。",
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
              // controller "self" 指能力控制者（chain/engine.ts 归一化）；exclude "self"
              // 排除来源对象（契约 3.6 锚点；解释器 queryObjects 执行）。
              filter: { type: "unit", zone: "board", controller: "self", exclude: "self" },
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
