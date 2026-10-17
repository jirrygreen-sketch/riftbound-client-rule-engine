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
 * status 判定（README 第 2 节）：executable。
 * - 临时 Might 修改由 RIFT-258 合入的卡牌侧 continuous.might 指令承担（arithmetic 层 +
 *   end-of-turn 期限，317.2.c）；链的 ResolveContext 适配器（chain/engine.ts）把
 *   addContinuous 接进 layers 引擎，golden 用真实 ChainEngine 结算触发体并断言
 *   图层 Might 与到期。`objects` 用合并原语的 { kind: "target", id } 选择描述符，
 *   让解释器适配器读取 Finalize 锁定的 TargetSpec；绝不用 Buff 计数器代替（702/703）。
 * - [Accelerate] 关键词已合入（RIFT-86），费用计划接受 optionalAdditional 的 accelerate
 *   条目并把费用付清后的单位替换为就绪入场（chain/engine.ts 的 entry-state 分支）——
 *   golden 用真实 ChainEngine 覆盖支付/拒绝两条路径。
 * - CardProgram 触发注册成生产 TriggerRegistration 属共享 RIFT-120 接线，按已合入
 *   executable 触发卡（ogn/jinx-demolitionist）的惯例保留 test.todo，不影响本卡数据。
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
        // 临时 Might -3（arithmetic 层，本回合结束到期）：RIFT-258 的 continuous.might。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          amount: { kind: "constant", value: -3 },
          duration: { kind: "constant", value: "end-of-turn" },
          objects: { kind: "constant", value: { kind: "target", id: ENEMY_UNIT } }
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
  status: "executable" as const,
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When you play me, give an enemy unit -3 :rb_might: this turn."
} satisfies CardProgram;

export default program;
