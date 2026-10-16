import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Riptide Mage (rad-058-167) — Unit, 4 energy + 1 Mind power, 3 Might.
 *
 * 原文："[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost "
 *       "to have me enter ready.)\n"
 *       "When you play me, give an enemy unit -3 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - 805.1 / 805.1.b：Accelerate 是可选附加费用关键词，费用固定为 [1][C]，不随卡牌变化，
 *   故 keyword 声明不带 value（effects/keywords/Accelerate.ts 已合入，valued: false，
 *   stacking: single；805.2.b 的延迟替代与 805.6.a 的"不触发 becomes ready"都在该展开里）。
 * - "When you play me"：Play Effect（383.4.a / 420.4.a），时点 card-played。
 * - "give an enemy unit -3 [M] this turn"：临时 Might 修改 = arithmetic 层的 Might 减算
 *   （143.2.a 的 Effective Might / 475），到期于本回合结束；X 不限位置（"an enemy unit"
 *   是全场范围），也不要求"here"。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * - 临时 Might 修改没有已注册的卡牌侧原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *   动作，effect.buff 只放/消耗 Buff counter（702），LayerEngine 只消费经
 *   ResolveContext.addContinuous 注册的 ContinuousEffectSpec（CardProgram static/指令未接线）。
 *   依赖：RIFT-91（layers-continuous）与后续 continuous.might / continuous.duration 原语批次。
 * [Accelerate] 关键词本身已合入（RIFT-86）。
 */

const ENEMY_UNIT = "riptide-mage.enemy-unit";

const abilities: Ability[] = [
  // 805.1.b：费用固定 [1][C]，keyword 不带数值；展开由 Accelerate KeywordDef 负责。
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "riptide-mage.give-minus-three-might",
        // 临时 Might -3（arithmetic 层，本回合结束到期）；原语未注册，见 judgeReason。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: { kind: "constant", value: -3 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: ENEMY_UNIT }
        },
        targets: [
          {
            id: ENEMY_UNIT,
            // "an enemy unit"（不限位置）→ 任一对手控制的 Board 上单位。
            filter: { type: "unit", controller: "opponent", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-b1ac774654b3c23d9236325b0e377a5c94866af93ca718bf2a30313a4cd027b4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「give an enemy unit -3 [M] this turn」需要已注册的临时 Might 修改原语：契约 3.6 的封闭 GameAction " +
    "集合没有 Might 修改动作，effect.buff 只放/消耗 Buff counter（702），LayerEngine 只消费经 " +
    "ResolveContext.addContinuous 注册的 ContinuousEffectSpec（CardProgram 指令未接线），" +
    "故 continuous.might（arithmetic 层 + 本回合结束到期，143.2.a/475）不可执行。" +
    "依赖：RIFT-91（layers-continuous）与后续 continuous.might / continuous.duration 原语批次。" +
    "[Accelerate] 关键词本身已合入（RIFT-86，805），由 Accelerate KeywordDef 展开；不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When you play me, give an enemy unit -3 :rb_might: this turn."
} satisfies CardProgram;

export default program;
