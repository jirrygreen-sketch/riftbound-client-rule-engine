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
 * 复核（2026-10-18，第三轮 M2 覆盖率复核）：continuous.grant-keyword、
 * effect.banish 与 356.4.f.1 的 result 条件谓词均已合入并可真实执行；本卡把
 * “if you paid the additional cost” 放在 card-played 触发条件上，和同类
 * Frostcoat Cub / Sea Monkey 保持同一契约形状。golden 执行原始 body，断言所选单位
 * 获得 Assault 2、来源不受影响及 turn-end 到期；费用规划与 card-played 回执投递仍留在
 * judgeReason 的生产接线缺口中。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口均不近似实现：
 * 1. 可选追加费用没有卡牌侧消费方：cost.additional 的计划词汇与 additional cost kind 已合入，
 *    但 programs/play.ts 仍拒绝 CardProgram 的 additional-cost 声明，buildCostPlan 只消费调用方
 *    传入的 optionalAdditional；因此 356.2.b.1 的 1 Energy 还不能进入该卡的 Finalize。
 * 2. “if you paid the additional cost” 的 Condition kind "result" 已合入并可读取模拟回执，
 *    但 card-played 触发没有收到被打出牌的 item.payment 结果，生产触发条件仍以
 *    MissingInformation 失败闭合（356.4.f.1）。
 * 3. 已合入并真实执行：continuous.grant-keyword 的 Assault 2 授予、effect.banish 的任意垃圾场
 *    选择，以及 end-of-turn 到期；关键词重展开与 Assault Might 消费由独立的
 *    KeywordGrantLayerEngine adapter 覆盖，但默认 CardProgram lifecycle 尚未接入该 adapter。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      // 356.2.b / 356.2.b.1：可选追加费用「1 Energy」。收费与凭据消费方未合入，
      // 但 CardProgram 先按静态费用契约声明，不能把费用伪造成结算期效果。
      kind: "cost.additional",
      id: "gust-monk.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [{ kind: "energy", amount: { kind: "constant", value: 1 } }]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 356.4.f.1：是否支付由追加费用回执记录，支付数额不是这里的条件。
      condition: { kind: "result", result: "additional-cost-paid", id: "gust-monk.additional-cost" }
    },
    optional: false,
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
        // 807.1.c 的 [Assault 2] 授予，期限为本回合（317.2.c 到期）。
        op: "continuous.grant-keyword",
        linkedTo: "gust-monk.banish-a-card-from-any-trash",
        args: {
          keyword: { kind: "constant", value: "assault" },
          value: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "end-of-turn" },
          target: { kind: "constant", value: "gust-monk.unit" }
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
    "两处当前生产接线缺口，均不近似实现：(1)「You may pay :rb_energy_1: as an additional cost to play me」是 " +
    "356.2.b/356.2.b.1 的可选追加费用；cost.additional 的计划词汇已合入，但 programs/play.ts 仍拒绝 " +
    "CardProgram 的 additional-cost 声明，buildCostPlan 只消费调用方传入的 optionalAdditional，因此 1 Energy " +
    "还不能进入该卡的 Finalize。(2)「if you paid the additional cost」的 Condition kind \"result\" 已合入，" +
    "但 card-played 触发没有收到被打出牌的 item.payment 结果，生产条件仍以 MissingInformation 失败闭合（356.4.f.1）。" +
    "已合入并有真实执行证据：effect.banish + 非目标 pick、continuous.grant-keyword 的 Assault 2 授予与 " +
    "end-of-turn 到期；KeywordGrantLayerEngine 可在独立 adapter 中重展开 Assault 的攻击者 Might，默认 CardProgram " +
    "lifecycle 尚未接入该 adapter。",
  abilities,
  sourceText:
    "You may pay :rb_energy_1: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, banish a card from any trash to give a unit " +
    "[Assault 2] this turn. (+2 :rb_might: while it's an attacker.)"
} satisfies CardProgram;
