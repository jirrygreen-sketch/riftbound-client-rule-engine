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
 * status = judge-required。已合入依赖与剩余生产接线已重新核对（2026-10-18 逐条实测）；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
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
      filter: { event: "card-played", filter: { source: "self" } },
      condition: {
        kind: "result",
        result: "cost.additional",
        id: "masa-crashing-thunder.additional-cost"
      }
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
    "仍缺：(1) programs/play.ts 未将 CardProgram static cost.additional 接入 Finalize 的 optionalAdditional，programs/statics.ts 也没有该费用类型的绑定；" +
    "(2) card-played 触发上下文未携带原打出的费用计划与支付回执，condition.result 的 cost.additional 条件无法读取 356.4.f.1 的支付决定；" +
    "(3) 目标的结构化 location: { type: battlefield } 尚未被 programs/filters.ts 的生产目标适配器支持。" +
    "实测（2026-10-18）：bindStatic 对 cost.additional 抛 \"Static ability kind cost.additional has no layer mapping\"；" +
    "translateInstructionTargets 对该目标抛 \"Structured location filters need a concrete battlefield identity\"；" +
    "programs/triggers.ts 注册 card-played 触发时，只要没有费用回执，条件求值就抛 " +
    "MissingInformation(Unavailable condition result: cost.additional)。" +
    "条件形状本身可求值：同一 condition.result 在注入 { plan, receipt } 的支付回执后返回 true（golden 覆盖已付/未付/折扣到 0 三支）。不近似实现费用或目标。",
  abilities,
  sourceText:
    "You may pay :rb_rune_order: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
