import type { CardProgram } from "../../ir/index.js";

/**
 * Mournful Witness (ven-028-166) — Unit, 2 Energy（无印刷 Power），2 Might,
 * Calm, Fae/Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-028-166，逐字）：
 *   When a combat that I was in ends, empower me. (I become Empowered if I'm not
 *   already.)
 *   [Empowered][>] I have +2 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 468.7 / 468.7.b：一次 Combat 流程结束时产生战斗结束效果，对应封闭时点 "combat-end"
 *   （events/timing-points.ts；events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 有
 *   "combat-ended"，events/pipeline-match.ts 把它映射到 combat-end）。
 * - “a combat that I was in” 需要 Attacker/Defender designation（323.2、466.2.c.3、
 *   468.7.a）；契约 3.8 第 1 条的 ObjectSnapshot.combatRole 只在契约层冻结了字段设计，
 *   engine-core 的 ObjectSnapshot 尚无该特征，事件载荷也不带角色信息。
 * - 442.1 / 442.1.b / 442.1.c：“empower me” 是 Empower 动作——把对象渲染为 Empowered；
 *   已 Empowered 的对象不能再次 Empower，重做时“nothing additional happens”。
 *   Empower 的来源自身不是目标（827.1.b.1 对关键词的同一原则），已合入的 effect.empower
 *   可用不写 targets 的 { kind: "source" } 选择直接作用于来源。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”，本条为静态 +2 Might（479 的算术图层）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. combat-end 时点没有发射方：combat/ 批次尚未把战斗结束接入事件管线（全仓库没有
 *    combat-end 的 emit 调用，combat/flow.ts 对战斗开始/伤害直接抛 TurnCombatBlockedError），
 *    触发无法进入链（combat 事件生产批次）；
 * 2. “a combat that I was in” 需要 combatRole/designation 特征，引擎侧未落地；
 * 3. “+2 [M]” 的 continuous.might 静态形状与图层求值已合入；本卡仍缺 Empowered
 *    状态门控的生产消费方。
 * body 的 “empower me” 只用已合入的 effect.empower，golden 用真实解释器与参考内核执行程序
 * 原始 body（含已 Empowered 时“什么都不发生”的 442.1.b/442.1.c 边界），照实记录原语返回结果。
 */
export default {
  canonicalCardId: "card.hash-9306105a8f30f0954fec4a0757dc246561b8408b00e76f9d104c939964b55bd0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) combat-end 时点（468.7/468.7.b）没有发射方——combat/ 未把战斗结束接入事件管线，" +
    "全仓库没有 combat-end 的 emit 调用，触发无法进入链（combat 事件生产批次）；(2) “a combat that I was in”" +
    "需要 Attacker/Defender designation（323.2、466.2.c.3、468.7.a），契约 3.8 的 ObjectSnapshot.combatRole" +
    "尚未落地、事件载荷不带角色信息；(3)「I have +2 :rb_might:」的 continuous.might 静态形状已合入，" +
    "但 Empowered 状态门控尚无生产消费方。body 的「empower me」只用已合入的 effect.empower（442.1；来源自身不是目标），" +
    "golden 用真实解释器执行并覆盖已 Empowered 时什么都不发生的边界。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-end",
        filter: { event: "combat-ended", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "mournful-witness.empower-self",
          op: "effect.empower",
          args: {
            // 442.1 / 827.1.b.1：Empower 的对象是来源自身，且不是目标。
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    },
    {
      // [Empowered][>] I have +2 :rb_might:（828.1.b.1 的依赖能力 + 479 算术图层）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 2 },
        appliesTo: "self"
      },
      // 828.1.c：仅在宿主拥有 Empowered 状态时生效；该门槛没有可求值的谓词，
      // 以描述性 expression 记录（同已合入的 applied-researchers / grumpy-rockbear）。
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "empowered" }
      }
    }
  ],
  sourceText:
    "When a combat that I was in ends, empower me. (I become Empowered if I'm not already.)\n" +
    "[Empowered][>] I have +2 :rb_might:."
} satisfies CardProgram;
