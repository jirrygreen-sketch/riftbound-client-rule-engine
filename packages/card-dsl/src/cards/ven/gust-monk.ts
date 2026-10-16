import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gust Monk (ven-101-166) — Unit, Chaos, tags Yordle/Bandle City.
 * 2 Energy, no printed Power（`power: null`，不是 0），Might 2。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-101-166，逐字）：
 *   You may pay :rb_energy_1: as an additional cost to play me.
 *   When you play me, if you paid the additional cost, banish a card from any trash to give a unit
 *   [Assault 2] this turn. (+2 :rb_might: while it's an attacker.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 356.2.b / 356.2.b.1：“pay … as an additional cost to play me” 且措辞含 “may”，是打出的
 *   Optional Additional Cost（355.1.a 在 Make Relevant Choices 决定是否支付）。
 * - 356.4.f.1：“If you paid the additional cost” 以“玩家决定支付”为凭证（与实付数额无关）。
 * - 383.4.a：“When you play me” 是 Play Effect（时点 card-played）。
 * - 355.10.c.1 / 428.5：“banish a card from any trash to give a unit …” 中 “:” 之前不是费用，
 *   但 “do X to do Y” 里的 “banish a card” 是**指令内的费用**，因此被放逐的牌不是目标
 *   （355.10.c.1 的 “[do X] to [do Y]”），按契约 3.6 用非目标 PickSpec + effect.banish
 *   （428.1/428.2：从任意区域把牌放进其拥有者的 Banishment；“any trash” 不限拥有者）。
 * - “give a unit [Assault 2] this turn”：807.1.c 规定 Assault 2 等价于攻击者时 +2 [M]；
 *   带回合期限的关键词授予属 continuous.grant-keyword 持续效果（契约 3.7），到期由 317.2.c
 *   （所有 “this turn” 效果同时到期）处理。“a unit” 是结算期选择（355.5 的 Choice），
 *   按契约 3.6 写成 TargetSpec。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处缺口均不近似实现：
 * 1. 可选追加费用没有消费方：effects/instructions/ 下没有 cost.additional 原语，也没有把卡牌程序
 *    声明的 CostSpec 接进 cost/ 计划的入口（buildCostPlan 只消费调用方传入的 optionalAdditional，
 *    RIFT-89）。程序按契约形状保留 play.cost 声明，不自行收费。
 * 2. “if you paid the additional cost” 没有可求值的凭据形态：356.4.f.1 的凭证是“玩家决定支付”，
 *    而冻结的 Condition/Expr 读不到费用计划的回执（同 ogn/clockwork-keeper、ogn/wallop 的
 *    condition.result 缺口，RIFT-89/90）。
 * 3. “[Assault 2] this turn” 是带 end-of-turn 期限的持续关键词授予：effects/instructions/ 下没有
 *    continuous.grant-keyword 原语（同 sfd/gem-jammer、ven/kayle-justified 的缺口，RIFT-83/RIFT-91）。
 * 已支持部分：“banish a card from any trash” 用已合入的 effect.banish + 非目标 pick 在参考内核里
 * 真实执行（含任意一方垃圾场），见 golden 测试。
 */
const abilities: Ability[] = [
  {
    kind: "play",
    // 356.2.b / 356.2.b.1：可选追加费用「1 Energy」。声明形状按契约数据保留，收费与凭据
    // 消费方未合入（见 judgeReason 第 1、2 点）。
    cost: {
      kind: "additional-cost",
      optional: true,
      payments: [{ kind: "energy", amount: { kind: "constant", value: 1 } }]
    },
    body: [
      {
        id: "gust-monk.banish-a-card-from-any-trash",
        op: "effect.banish",
        args: {
          // 355.10.c.1：指令内的费用半段，非目标选择。
          objects: { kind: "constant", value: { pick: "gust-monk.card-in-any-trash" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "banished-for-assault" }
        },
        picks: [
          {
            id: "gust-monk.card-in-any-trash",
            // “any trash”：不限定拥有者/控制者，任意玩家的垃圾场都在集合内。
            options: ["dynamic:any-card-in-any-trash"],
            filter: { zone: "trash" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "gust-monk.give-assault-2",
        // 807.1.c 的 [Assault 2] 授予，期限为本回合（317.2.c 到期）；原语未合入。
        op: "continuous.grant-keyword",
        linkedTo: "gust-monk.banish-a-card-from-any-trash",
        args: {
          keyword: { kind: "constant", value: "assault" },
          value: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            id: "gust-monk.unit",
            // “a unit”：未特别说明时指 Board 上的单位（355.9.a.1）。
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-ac392c4087040dcdd16d8c56b9819899610a8873fb5b8314becec875dc3ef0a1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「You may pay :rb_energy_1: as an additional cost to play me」是 " +
    "356.2.b/356.2.b.1 的可选追加费用，但 effects/instructions/ 下没有 cost.additional 原语，" +
    "也没有把卡牌程序的 CostSpec 接进 cost/ 计划的入口（buildCostPlan 只消费调用方传入的 optionalAdditional，RIFT-89）；" +
    "(2)「if you paid the additional cost」按 356.4.f.1 以「玩家决定支付」为凭证，冻结的 Condition/Expr " +
    "没有读取费用回执的形态（condition.result 缺口，同 clockwork-keeper/wallop，RIFT-89/90）；" +
    "(3)「give a unit [Assault 2] this turn」是带 end-of-turn 期限的持续关键词授予，没有已注册的 " +
    "continuous.grant-keyword 原语（同 gem-jammer/kayle-justified，RIFT-83/RIFT-91）。" +
    "已支持部分：「banish a card from any trash」用 effect.banish + 非目标 pick（355.10.c.1/428.5）在 golden 中真实执行。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, banish a card from any trash to give a unit " +
    "[Assault 2] this turn. (+2 :rb_might: while it's an attacker.)"
} satisfies CardProgram;
