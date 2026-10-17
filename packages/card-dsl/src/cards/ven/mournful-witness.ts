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
 *   468.7.a）；ObjectSnapshot.combatRole 已存在，但
 *   468.7.a 清除 designation 后仍需要本次参战历史，不能只查询当前角色。
 * - 442.1 / 442.1.b / 442.1.c：“empower me” 是 Empower 动作——把对象渲染为 Empowered；
 *   已 Empowered 的对象不能再次 Empower，重做时“nothing additional happens”。
 *   Empower 的来源自身不是目标（827.1.b.1 对关键词的同一原则），已合入的 effect.empower
 *   可用不写 targets 的 { kind: "source" } 选择直接作用于来源。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”，本条为静态 +2 Might（479 的算术图层）。
 *
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
 */
export default {
  canonicalCardId: "card.hash-9306105a8f30f0954fec4a0757dc246561b8408b00e76f9d104c939964b55bd0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "当前缺口是 468.7/468.7.b 的 combat-end 生产与参战历史：combat/flow.ts 尚无战斗结束发射路径，无法在 468.7.a 清除 Attacker/Defender designation 后判断“a combat that I was in”。ObjectSnapshot.combatRole 已存在，但当前角色不能代替本次战斗的参与记录。effect.empower、compare(object-property self empowered) 与 continuous.might 静态绑定已可在参考内核真实执行；ObjectSnapshot 契约仍需声明 empowered 特征。golden 覆盖二次 Empower 不重复执行、状态门控 +2 Might 和 Disempower 后撤销；不近似实现战斗触发。",
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
          },
          // 442.1.b/c：已 Empowered 时不再次提交 Empower 动作。
          condition: {
            kind: "compare",
            left: { kind: "object-property", object: "self", property: "empowered" },
            operator: "eq",
            right: { kind: "constant", value: 0 }
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
      // 828.1.c：状态门槛由生产静态绑定器求值。
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "empowered" },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "When a combat that I was in ends, empower me. (I become Empowered if I'm not already.)\n" +
    "[Empowered][>] I have +2 :rb_might:."
} satisfies CardProgram;
