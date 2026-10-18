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
  judgeReason:
    "三处当前缺口（2026-10-17 RIFT-733 复核实测）：" +
    "(1) 468.7/468.7.b 的 combat-end 没有生产发射方：combat/flow.ts 的 cleanup/advance 只发 contested-applied/control-lost/showdown 等，" +
    "且 start() 对 staged combat 直接抛 TurnCombatBlockedError('combat-start-transaction')；duel/engagement-executor-v2.ts 里的 " +
    "combat-end 只是 gate 名称而非 emission。触发因此无法在战斗结束时点绑定。" +
    "(2) “a combat that I was in”缺参战历史：ObjectSnapshot.combatRole 只是当前 designation，468.7.a 清除 Attacker/Defender 后无法回看本次战斗是否参战。" +
    "(3) [Empowered][>] 的 continuous.might 静态门控读 object-property \"empowered\"，而 effects/contract.ts 的 ObjectSnapshot 未声明该特征；" +
    "生产内核 apps/game-server/src/engine-runtime/host.ts 把 empower/disempower 落到 buffs 且不暴露 empowered，" +
    "programs/statics.ts 的条件求值捕获失败后返回 false，静态 +2 Might 在生产不可证明（参考内核的 effect.empower、compare 与 continuous.might 已真实执行）。" +
    "不近似实现战斗触发与状态门控。",
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
