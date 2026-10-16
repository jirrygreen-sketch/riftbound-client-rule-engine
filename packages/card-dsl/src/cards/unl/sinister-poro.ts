import type { CardProgram } from "../../ir/index.js";

/**
 * Sinister Poro (unl-137-219) — Unit, Chaos, tags Poro / Shadow Isles。
 * catalog：energy 2、power 1、might 1。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-137-219，逐字）：
 *   When I attack, you may pay :rb_energy_1: to move an enemy unit here to its base.
 *
 * 规则依据（CR v1.5）：
 * - “When I attack”：Attack Trigger（383.4.e，unit 取得 Attacker 身份后进链；383.4.e.2 规定
 *   每次战斗只检查一次条件），封闭时点 attack-declared（timing-points.ts，refs 323.2/383.4.e/
 *   466.2.c）。
 * - “you may pay :rb_energy_1: to move …”：付费是 204.3.a 的 Cost within Instructions，
 *   “pay X to Y” 里 [do X] 是费用、[do Y] 是效果。它紧跟在效果开头的 “you may” 之后，
 *   按 383.3.b/383.3.b.1 被当作**触发能力的基础费用**：必须在 Finalize 支付才能把触发放进链，
 *   付不出则整条触发不成立；383.3.e.2.a/b 的 “you may” 同样是 Finalize 决定（拒绝则移出链）。
 * - “an enemy unit here”：对手控制、与来源同位置的单位（740.1.b 的 enemy、359.3.f 的 here），
 *   是单个选目标（355.7/355.9.a），用 sameLocationAs: "source" 锚点表达。
 * - “to its base”：目的地是该单位控制者的 Base。effect.move 用字面量 "controller-base"
 *   表达（与 ogn/maddened-marauder、ogn/fight-or-flight 同一写法）；448.3.a 的“移动到当前位置”
 *   不适用（Base 与战场必然不同）。
 *
 * status = judge-required（缺口不近似实现）：
 * - “pay :rb_energy_1:” 的 Finalize 语义没有接线：契约 3.1 的 TriggeredAbility 没有 CostSpec
 *   字段（只有 activated/play 带 cost），因此 383.3.b.1 的“付 1 能量才算成立”与拒绝即移出链的
 *   行为无法表达；把付费写进 body 只会在结算时执行，错过 415.4/415.5 与 203.3 的支付校验，
 *   也做不出“付不出则不触发”的负例。
 * - attack-declared 在已合入代码里没有发射路径：combat/ 不发出该时点（同 rad/ezreal-dashing、
 *   sfd/lucian-gunslinger 的记录），触发无法在真实内核里被订阅。
 * 已合入且被 golden 真实执行的是效果本体：effect.move 把锁定的敌方单位移到它自己的 Base
 * （controller-base 逐对象解析），并验证目标失效时按 359.3.e 被忽略。
 *
 * 依赖：RIFT-89/90（触发能力的 Finalize 费用与费用计划接线）、RIFT-33（战斗时点发射路径）。
 */
export default {
  canonicalCardId:
    "card.hash-012e505f18f7dd78843bcdd1d710fa4398ff99390018e2e21b662d53ed596e01",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 「you may pay :rb_energy_1: to move …」的付费紧跟在效果开头的 “you may” 之后：" +
    "383.3.b/383.3.b.1 把它当作触发能力的基础费用（必须在 Finalize 支付，付不出则整条触发移出链），" +
    "383.3.e.2.a/b 的 “you may” 也是在 Finalize 决定的；契约 3.1 的 TriggeredAbility 没有 CostSpec 字段" +
    "（只有 activated/play 带 cost），因此“付 1 能量才成立 / 拒绝即移出链 / 415.4-415.5 的付得出校验”" +
    "都无法表达，需要费用接线（RIFT-89/90）。" +
    "(2) attack-declared 时点（383.4.e）在已合入代码里没有发射方：combat/ 尚未接入事件管线，触发无法被真实订阅" +
    "（同 rad/ezreal-dashing、sfd/lucian-gunslinger 的记录）。已合入且由 golden 真实执行的是效果本体：effect.move 把" +
    "锁定的敌方单位移到其控制者的 Base（controller-base 逐对象解析），并按 359.3.e 忽略失效目标；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      // 383.3.e.2 / 383.3.e.2.a-b：效果开头的 “you may” 是 Finalize 决定（拒绝则整条触发移出链），
      // 因此按触发级 optional 表达，而不是效果内部的 choice.optional。
      optional: true,
      body: [
        {
          id: "sinister-poro.pay-energy",
          // 印刷的 “pay :rb_energy_1:” 属于 383.3.b 的触发能力基础费用：真实语义是在 Finalize
          // 由费用计划收取（383.3.b.1）。契约 3.1 的 TriggeredAbility 没有 CostSpec 字段，
          // 因此这条指令只是费用的描述性记录，绝不能被当作结算时动作（见 judgeReason）。
          op: "cost.pay",
          args: {
            energy: { kind: "constant", value: 1 }
          }
        },
        {
          id: "sinister-poro.move-enemy",
          linkedTo: "sinister-poro.pay-energy",
          // “to move an enemy unit here to its base”：204.3.a 的 Effect（[do Y]）。
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "sinister-poro.enemy-unit-here" }
            },
            to: { kind: "constant", value: "controller-base" },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          },
          targets: [
            {
              id: "sinister-poro.enemy-unit-here",
              // “an enemy unit here”（740.1.b + 359.3.f）
              filter: {
                type: "unit",
                controller: "opponent",
                sameLocationAs: "source"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, you may pay :rb_energy_1: to move an enemy unit here to its base."
} satisfies CardProgram;
