import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Masa, Crashing Thunder (ven-120-166) — Unit, 4 Energy, Might 4, Order,
 * tags Yordle / Bandle City.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-120-166，逐字）：
 *   You may pay :rb_rune_order: as an additional cost to play me.
 *   When you play me, if you paid the additional cost, [Stun] an enemy unit at
 *   a battlefield. (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 356.2 / 356.2.b / 356.2.b.1："You may pay [1 Order Power] as an additional cost
 *   to play me" 是被打出卡牌上的被动能力所规定的**可选追加费用**；支付决定属于 Play
 *   流程的费用步骤（355.1/355.1.a），分量在 356.2 应用。费用里的对象由玩家选定，
 *   不是目标（355.10.c），故本条按契约 3.1 声明为 static 的 cost.additional。
 * - 163.2：:rb_rune_order: 是 1 枚 Order Power（163.2 的域费用）；写成 payments 里
 *   kind: "power" + allowedDomains: ["Order"]（cost/plan-values.ts 读该形状）。
 * - 383.4.a / 383.4.a.1 / 420.4.a：「When you play me」是 Play Effect，封闭时点
 *   "card-played"，filter 用 { source: "self" } 指向来源本体。
 * - 356.4.f.1：「if you paid the additional cost」以「玩家做出了支付决定」为凭证——
 *   即使折扣把费用减到 0，也视为已支付；该凭证属费用计划回执，不是胜负/数值条件。
 * - 424 / 424.1 / 424.1.a："[Stun] an enemy unit at a battlefield" 是 Stun（把
 *   Board 上的一个单位渲染为 Stunned）；目标是一个敌方单位，"at a battlefield" 是它的
 *   位置限制（355.10.b），不是第二个目标。已合入原语 effect.stun（RIFT-112 批次）就是
 *   该动作；括号里的文字是 424.1.b/424.1.c 的提示文本，不构成第二条能力。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. 缺「可选追加费用」的收取与回执：effects/instructions/ 没有 cost.additional /
 *    cost.sacrifice 指令原语（RIFT-9 清单），也没有把卡牌程序声明的费用接进已合入
 *    cost/ 计划的接线（buildCostPlan 只消费调用方传入的 optionalAdditional）；冻结 IR
 *    没有费用结果绑定（调研记为 condition.result），故第二条无法按已付/未付开闸。
 *    这里不伪造恒真条件，也不把费用改写成效果。
 * 2. Play Effect 触发没有 end-to-end 注册路径（RIFT-120 后续）；"Stun an enemy unit at
 *    a battlefield" 的 effect.stun 本体已合入，golden 用真实解释器 + 最终化目标执行。
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：被打出卡牌上的被动能力规定的可选追加费用。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "masa-crashing-thunder.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "power",
          // 163.2：:rb_rune_order: 是 1 枚 Order Power。
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Order"]
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "masa-crashing-thunder.stun-enemy-unit",
        op: "effect.stun",
        args: {
          target: {
            kind: "constant",
            value: "masa-crashing-thunder.enemy-unit"
          }
        },
        targets: [
          {
            id: "masa-crashing-thunder.enemy-unit",
            // “an enemy unit at a battlefield”：敌方单位 + 位置限制（355.10.b）。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              location: { type: "battlefield" }
            },
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
  canonicalCardId:
    "card.hash-136c3803080e71b9a47e3adff1362584873339a31072f939e14afa55abc3ecd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 缺「可选追加费用」的收取与回执：effects/instructions/ 没有 cost.additional / " +
    "cost.sacrifice 指令原语（RIFT-9 清单），也没有把卡牌程序声明的费用接进已合入 cost/ 计划的接线" +
    "（buildCostPlan 只消费调用方传入的 optionalAdditional），费用侧只声明了 356.2.b/163.2 的 1 Order Power 分量；" +
    "356.4.f.1 规定「If you paid the additional cost」以「玩家决定支付」为凭证，冻结 IR 没有费用结果绑定" +
    "（调研记为 condition.result），程序里不写恒真条件、也不把费用改写成效果。(2) 「When you play me」的 Play " +
    "Effect 触发（383.4.a.1）尚无 end-to-end 注册路径（RIFT-120 后续），触发不会自行进入链。" +
    "依赖：RIFT-9（cost.additional / cost.sacrifice）、RIFT-89（费用计划接线与回执）、RIFT-120（触发注册）。" +
    "「[Stun] an enemy unit at a battlefield」半段用已合入的 effect.stun 真实执行（golden 覆盖普通、已 Stunned、" +
    "目标失效三种情形）。",
  abilities,
  sourceText:
    "You may pay :rb_rune_order: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
