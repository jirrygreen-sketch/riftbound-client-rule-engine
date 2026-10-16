import type { CardProgram } from "../../ir/index.js";

/**
 * Affectionate Poro (ven-024-166) — Unit, 3 Energy（无印刷 Power），3 Might,
 * Calm, Poro/Noxus。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-024-166，逐字）：
 *   When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 468.7 / 468.7.b：一次 Combat 流程结束时产生战斗结束效果，对应封闭时点
 *   events/timing-points.ts 的 "combat-end"（ruleRefs 468.7/468.7.b）；events/trigger-spec.ts
 *   的 EVENT_PATTERN_TYPES 有对应判别值 "combat-ended"（events/pipeline-match.ts 把它映射到
 *   combat-end 时点）。
 * - “a combat that I was in” 要求“本卡是那次战斗的参与者”：战斗身份是 Attacker/Defender
 *   designation（323.2、466.2.c.3、468.7.a），契约 3.8 第 1 条的 ObjectSnapshot.combatRole 只在
 *   契约里冻结了字段设计，engine-core 的 ObjectSnapshot 尚无该特征，因此“我在那次战斗里”
 *   这一事实没有可判定的载荷。
 * - “if I haven't been dealt damage this turn” 是本回合的伤害历史（418.1.b 的 damage marked
 *   on it；时点 damage-dealt 的载荷带 targetId）：需要按“本回合 + 目标 = 本卡”的事件计数谓词。
 * - 414.1 / 414.3：“draw 1” 是抽 1 张（从主牌库顶），抽牌者缺省为能力控制者（190.6.d）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. combat-end 时点没有发射方：combat/ 批次尚未把战斗结束接入事件管线
 *    （combat/flow.ts 对战斗开始/伤害等直接抛 TurnCombatBlockedError；全仓库没有 combat-end 的
 *    emit 调用），触发无法进入链（RIFT-120 / 引擎批 4–5）；
 * 2. “a combat that I was in” 需要 Attacker/Defender designation（契约 3.8 的
 *    ObjectSnapshot.combatRole 未落地），事件载荷里也没有可读取的角色信息；
 * 3. “if I haven't been dealt damage this turn” 需要本回合、按对象过滤的事件计数谓词——
 *    HistoryQuery 的封闭集合（scope/action/timingPoint/player/object）与卡牌侧的 Condition
 *    （always/never/compare/all/any/not/expression）之间没有把 history 计数暴露给触发条件的路径，
 *    因此该条件以描述性记录保留，绝不写成恒真条件。
 * body 的 “draw 1” 只用已合入的 effect.draw，golden 用真实解释器与参考内核执行程序原始 body
 * （含空牌库的实际抽到 0 张边界）。
 */
export default {
  canonicalCardId: "card.hash-7147fd68039b666d195da6d7372d88c419ee1487989e3243510c28f11248e3f3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) combat-end 时点（468.7/468.7.b）没有发射方——combat/ 未把战斗结束接入事件管线，" +
    "全仓库没有 combat-end 的 emit 调用，触发无法进入链（RIFT-120 / 引擎批 4–5）；(2) “a combat that I was in”" +
    "要求 Attacker/Defender designation（323.2、466.2.c.3、468.7.a），契约 3.8 的 ObjectSnapshot.combatRole" +
    "尚未落地、事件载荷也不带角色信息，无法判定本卡是否参与那次战斗；(3) “if I haven't been dealt damage this turn”" +
    "需要本回合按对象过滤的伤害事件计数谓词——HistoryQuery 的封闭字段与卡牌侧 Condition 之间没有把 history" +
    "计数暴露给触发条件的路径，故以描述性条件保留，绝不写成恒真条件。body 的 “draw 1”（414.1/414.3）" +
    "只用已合入的 effect.draw，golden 用真实解释器执行（含空牌库抽到 0 张的边界）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-end",
        // 468.7.b：一次 Combat 流程结束时触发的战斗结束效果。
        filter: { event: "combat-ended", filter: { source: "self" } },
        // “if I haven't been dealt damage this turn”：本回合“未被打伤”的事件历史门槛。
        // 该谓词没有可求值的绑定（见 judgeReason 第 3 条），以描述性 expression 记录；
        // 不写成永远为真的条件来让触发照常生效。
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "not-dealt-damage-this-turn" }
        }
      },
      optional: false,
      body: [
        {
          id: "affectionate-poro.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1."
} satisfies CardProgram;
