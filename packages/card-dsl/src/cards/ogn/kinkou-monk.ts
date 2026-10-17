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
 * status: judge-required —— production binding still has one real gap:
 * Finalize's candidate query does not consume the `exclude` anchor. The
 * interpreter re-checks a locked selection correctly (the golden covers that
 * boundary), but `programs/filters.ts` rejects the anchor while translating
 * the registered trigger body, so the production trigger cannot be bound
 * without broadening the target/filter contract.
 * effect.buff 本体已合入，golden 测试以真实原语 + 解释器执行 body 的目标形态与排除边界。
 */
export default {
  canonicalCardId: "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.buff 本体已合入（702.2.a/702.3.a），解释器在锁定目标重验时也会执行 exclude；" +
    "但生产 CardProgram binding 仍不能表达这张卡的 other 限制：programs/filters.ts 在翻译注册触发体时拒绝 exclude，" +
    "而 Finalize 候选查询也没有消费该锚点。若放行未知锚点，来源会错误地进入合法候选集（355.7）。不近似实现。",
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
