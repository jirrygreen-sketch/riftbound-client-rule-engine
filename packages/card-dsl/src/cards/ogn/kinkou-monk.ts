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
 * status: judge-required —— 两处缺口：
 * 1. Finalize 的候选集仍可能包含来源：chain/engine.ts 的 context.query（target-plan 的
 *    legalCandidates 使用它）在合并实现里只把 controller/owner 的 self/opponent 归一化后
 *    交给 layers/filter.ts 的 matchesObjectFilter，而它不实现 exclude/sameLocationAs 等
 *    锚点（未知键被忽略），所以生产 Finalize 会把来源本身作为合法候选提供给玩家；
 *    解释器在重验已锁定时会经 queryObjects 正确执行 exclude（golden 有执行证据），
 *    但候选提供阶段的锚点支持仍未合入（RIFT-90 目标系统的查询接线）。
 * 2. card-played 时点由 chain/engine.ts 发射，但把卡牌触发注册成 TriggerRegistration
 *    的订阅方仍未合入（RIFT-257）。
 * effect.buff 本体已合入，golden 测试以真实原语 + 解释器执行 body 的目标形态与排除边界。
 */
export default {
  canonicalCardId: "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "effect.buff 本体已合入（702.2.a/702.3.a，原语文档也以本卡为例），排除来源的锚点 exclude 也由解释器的" +
    "queryObjects 执行（golden 对「锁定来源时被忽略」有执行证据），但整卡仍不可执行：" +
    "(1) Finalize 候选集可能包含来源——target/target-plan.ts 的 legalCandidates 走 chain/engine.ts 的 context.query，" +
    "它把 self/opponent 归一化后交给 layers/filter.ts 的 matchesObjectFilter，而后者不实现 exclude/sameLocationAs 等锚点" +
    "（未知键被忽略），所以生产候选提供阶段仍会把来源列为合法对象（355.7 的 other 限制未在候选阶段生效）；" +
    "(2) card-played 时点已由 chain/engine.ts 发射，但把卡牌触发注册成 TriggerRegistration 的订阅方属 RIFT-257。" +
    "依赖：RIFT-90（目标系统的查询锚点接线）与 RIFT-257。不近似实现。",
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
