import type { CardProgram } from "../../ir/index.js";

/**
 * Heart of the Tempest (ven-155-166) — Legend, Order/Chaos, Yordle/Kennen.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-155-166，逐字）：
 *   When you play a card from anywhere other than your hand, empower me.
 *   [Action][>] Disempower me, :rb_exhaust:: Give a unit [Assault 2] this turn.
 *   (+2 :rb_might: while it's an attacker.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1/383.2.a/383.4.a：“When you play a card …” 是打出触发；封闭时点
 *   "card-played"（359、383.4.a、407）承载。
 * - 806.1.d：[Action][>] 表示后面的启动能力拥有 Action 许可；契约 3.1 用
 *   activated.timing = "action" 声明该能力速度（对照 Daughter of the Void 的
 *   [Reaction] 用 timing = "reaction" 记录，而非伪造卡级关键词）。
 * - 404.1.a/415.5：印刷 “Disempower me, :rb_exhaust:” 中 “:” 前的 Disempower 与
 *   Exhaust 都是启动费用；443.2/443.2.a 的 Disempower 是 Limited Action。
 * - 807.1.c：“[Assault 2] this turn” 是暂时授予 Assault 2，由 RIFT-258 已合入的
 *   continuous.grant-keyword 指令原语注册 ability 层持续效果（317.1.a / 468.7.c
 *   的本回合期限）；Assault 自身的展开由已合入的 RIFT-81 KeywordDef 提供。
 *
 * status = judge-required（两处缺口均不近似实现）：
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：
 * - 旧 judgeReason 的「cost.pay / cost.modify 未合入（RIFT-261）」已不成立：
 *   effects/instructions/cost.pay.ts 与 cost.modify.ts 已注册；真实缺口只剩
 *   disempower 付费种类本身。
 *
 * 1. “from anywhere other than your hand” 无法表达：card-played 的 EventPattern
 *    只有 fromZone 等值匹配，没有否定形式，且 chain/engine.ts 发出的 card-played 事件
 *    不带 fromZone 载荷；filter 里以描述性 notFromHand 记录该否定条件
 *    （契约变更请求）；
 * 2. “Disempower me” 作为费用需要 disempower 付费种类（443.2.a），
 *    cost/plan-values.ts 的非标准费用只支持 exhaust/discard/recycle/kill/reveal/
 *    spend-buff（readCost 实测 CostPlanError）。
 *
 * 已合入部分的执行证据：触发 body “empower me” 用 effect.empower；“Give a unit
 * [Assault 2] this turn” 用 continuous.grant-keyword（RIFT-258），golden 通过真实
 * 解释器注册 ability 层效果并断言本回合到期。
 */
export default {
  canonicalCardId: "card.hash-aa310ded3ca355bccab78b17783adac7b21e0b2477c14135b2cf52ebad7d96a5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) “from anywhere other than your hand” 无法表达——card-played 的 " +
    "EventPattern 只有 fromZone 等值匹配、没有否定形式，chain/engine.ts 发出的 card-played 事件也不带 " +
    "fromZone 载荷，程序里以描述性 notFromHand 记录（契约变更请求）；(2) “Disempower me” 作为费用需要 " +
    "disempower 付费种类（443.2.a），cost/plan-values.ts 的非标准费用只支持 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff（readCost 实测 CostPlanError）；指令级 cost.pay / " +
    "cost.modify 原语均已注册，与本卡的启动费用路径无关。“empower me” 本体用已合入的 effect.empower；" +
    "“Give a unit [Assault 2] this turn” 已由 continuous.grant-keyword（this-turn 期限）真实执行并由 golden 覆盖。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: {
            // “you play a card” → 事件玩家是能力控制者。
            player: "self",
            // “anywhere other than your hand”：需要 fromZone 否定（事件当前也不带该
            // 载荷），故写成描述性键，不伪造一个等值 fromZone。
            notFromHand: true
          }
        }
      },
      optional: false,
      body: [
        {
          id: "heart-of-the-tempest.empower-self",
          op: "effect.empower",
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    },
    {
      kind: "activated",
      // [Action][>]：按契约 3.1 用 activated.timing 记录 Action 许可。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          { kind: "disempower", object: "self" },
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "heart-of-the-tempest.grant-assault",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            // “a unit”：355.9.a.1 / 355.10.a 的目标，TargetSpec 在 Finalize 锁定；
            // continuous.grant-keyword 的 target 参数取 TargetSpec id。
            target: {
              kind: "constant",
              value: "heart-of-the-tempest.unit"
            }
          },
          targets: [
            {
              id: "heart-of-the-tempest.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play a card from anywhere other than your hand, empower me.\n" +
    "[Action][>] Disempower me, :rb_exhaust:: Give a unit [Assault 2] this turn. " +
    "(+2 :rb_might: while it's an attacker.)"
} satisfies CardProgram;
