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
 * - 414.1 / 414.3：“draw 1” 是抽 1 张（从主牌库顶），抽牌者缺省为能力控制者（190.6.d）。
 *
 * status = judge-required（2026-10-18 M2 复核，三处缺口均实测，不近似实现）：
 * 1. combat-end 时点没有发射方：全仓库没有任何 combat-end 的 emit 调用；实测跑完整个真实回合
 *    只发出 turn-start、awaken/beginning/channel/draw/main 与区域/状态事件，把一场
 *    staged Combat 推进到 Combat 起点会从 CombatFlow.advance() 抛
 *    TurnCombatBlockedError('combat-start-transaction')，attack-declared / combat-end 都不会
 *    进入唯一事件管线（466.2）。
 * 2. “a combat that I was in” 无法判定：契约 3.8 的 ObjectSnapshot.combatRole 字段确实已声明
 *    （effects/contract.ts），但没有任何生产路径写入它——engine-runtime/host.ts 恒定构造
 *    combatRole: null，只有参考内核接受用例传入的角色；事件载荷里也没有可读取的战斗身份。
 * 3. “if I haven't been dealt damage this turn” 需要本回合按对象过滤的伤害事件计数谓词：
 *    HistoryQuery 已有 objectFilter/exclude，但卡牌侧 Condition/Requirement 没有 history 计数
 *    形态，默认解释器也不支持 RIFT-711 的扩展表达式（实测 evaluateExpression 对
 *    player-property / turn-number / object-designation 抛 “Unsupported expression”）。
 *    因此该门槛写为 { kind: "all", conditions: [{ kind: "never" }, <描述性 expression>] }：
 *    单写 { kind: "expression" } 的求值是 Boolean(常量字符串) 恒真，会把未支持的门槛当成已通过；
 *    钳成恒假后不把未实现的条件当成功。
 * body 的 “draw 1” 只用已合入的 effect.draw，golden 用真实解释器与参考内核执行程序原始 body
 * （含空牌库的实际抽到 0 张边界）。
 */
export default {
  canonicalCardId: "card.hash-7147fd68039b666d195da6d7372d88c419ee1487989e3243510c28f11248e3f3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-18 复核，均为实测）：(1) combat-end 时点没有发射方——全仓库没有 combat-end 的 " +
    "emit 调用，跑完真实回合只发出 turn-start/各阶段开始与区域状态事件，把 staged Combat 推进到起点会抛 " +
    "TurnCombatBlockedError('combat-start-transaction')（466.2），触发无法进入链；(2) “a combat that I was in” " +
    "要求 Attacker/Defender designation（323.2、466.2.c.3、468.7.a）：契约 3.8 的 ObjectSnapshot.combatRole 字段已声明，" +
    "但没有生产写入方——engine-runtime/host.ts 恒定给 combatRole: null，事件载荷也不带战斗身份，无法判定本卡是否参与那次战斗；" +
    "(3) “if I haven't been dealt damage this turn” 需要本回合按对象过滤的伤害事件计数谓词：HistoryQuery 已有 " +
    "objectFilter/exclude，但卡牌侧 Condition/Requirement 没有 history 计数形态，默认解释器也不支持 RIFT-711 的扩展表达式" +
    "（实测 player-property/turn-number/object-designation 抛 Unsupported expression），故以 “all[never, 描述性 expression]” " +
    "的恒假形态保留——单写 expression 是 Boolean(常量) 恒真，绝不能把未支持门槛当成已通过。body 的 “draw 1”（414.1/414.3）" +
    "只用已合入的 effect.draw，golden 用真实解释器执行（含空牌库抽到 0 张的边界）。依赖：combat 时点发射与战斗身份、" +
    "本回合伤害历史谓词。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "combat-end",
        // 468.7.b：一次 Combat 流程结束时触发的战斗结束效果。
        filter: { event: "combat-ended", filter: { source: "self" } },
        // “if I haven't been dealt damage this turn”：本回合“未被打伤”的事件历史门槛。
        // 该谓词没有可求值的绑定（见 judgeReason 第 3 条），以描述性 expression 记录，
        // 并整体用 { kind: "never" } 钳成恒假（与 unl/master-yi-tempered、
        // unl/mosstomper 的 fail-closed 写法一致）：{ kind: "expression" } 的求值是
        // Boolean(常量字符串)，单独写会恒真并把未支持的门槛当成已通过。
        condition: {
          kind: "all",
          conditions: [
            { kind: "never" },
            {
              kind: "expression",
              value: { kind: "constant", value: "not-dealt-damage-this-turn" }
            }
          ]
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
