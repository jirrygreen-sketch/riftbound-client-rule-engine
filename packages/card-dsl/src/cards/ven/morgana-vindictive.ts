import type { CardProgram } from "../../ir/index.js";

/**
 * Morgana, Vindictive (ven-017-166) — Unit, 5 Energy + 1 Fury Power, 5 Might,
 * Fury, Demacia/Morgana/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-017-166，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   When you play me, deal damage to a unit equal to the damage marked on it.
 *
 * 规则依据（CR v1.5）：
 * - 822.1.b / 822.1.c：[Ambush] 是 Passive Ability keyword，功能等价于“我可以被打到
 *   你有单位的战场”，并给该次打出 Reaction 时机；822.2 说明多个实例冗余。按契约
 *   3.7 卡牌只声明 `{ kind: "keyword", keyword: "ambush" }`，展开由已合入的
 *   effects/keywords/Ambush.ts 负责（该文件已随 RIFT-266 合入）。
 * - 383.4.a / 383.4.a.1 / 420.4.a：“When you play me” 是 Play Effect，时点为封闭的
 *   "card-played"（chain/engine.ts 在链项打出完成后发出），filter 用契约 3.6 的符号
 *   选择器 { source: "self" } 指向能力来源本体，不写运行时 ObjectRef。
 * - 418.1.b / 418.1.c：Deal 是把指定数额的伤害标记到单位上；本卡的数额是“该单位身上
 *   已标记的伤害”（142.3/143.3 的 damage marked on it），即目标当前 `damage` 特征。
 *   契约 3.6 的 `object-property` 表达式在执行时读取该特征（取值时机即调用时），
 *   因此用 { object: { target: ... }, property: "damage" } 而不是写死常量。
 * - 418.1.e / 418.1.e.1：只有正整数伤害会被造成；目标身上没有伤害时数额为 0，本指令
 *   按契约 3.6 原语规则 2 返回 negated(impossible)，且不标记任何伤害。
 * - 355.9.a.1 / 355.10：“a unit” 是玩家在 Finalize 选择的一个对象（未特别说明时指
 *   Board 上的单位），因此是 TargetSpec（不是 pick）。
 *
 * status = judge-required："deal damage equal to the damage marked on it" 半段
 * 只用已合入原语（effect.damage + object-property 读取），golden 用真实解释器/参考
 * 内核执行并覆盖 0 伤害边界；但 [Ambush] 的两条许可没有消费方——
 * effects/keywords/Ambush.ts 展开出的 `play-location-permission`（822.1.b/c 的合法
 * 打出位置）与 `continuous.timing`（Reaction 许可）都还没有 Finalize 位置选择与
 * chain canAct 的消费方（该文件头已记录："play-location-permission / target.location
 * still needs the Finalize location-choice consumer" 与 "continuous.timing and Chain
 * canAct still need to consume the conditional Reaction permission"），822.3 的
 * Finalize 前重验也同样缺接线。故整卡不能宣称可执行（cards README 第 2 节：仅结构
 * 校验通过或 IR 可表达不够）。不近似实现：不把 [Ambush] 写成普通的战场打出许可，也
 * 不用某个固定地点冒充。
 */
export default {
  canonicalCardId: "card.hash-6b5c19257cf27d1dd9fba350525b81aaed82f21aacca46a1c0920853f044a5b4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Ambush]（822）的两条许可没有消费方：effects/keywords/Ambush.ts 已展开为 " +
    "play-location-permission（822.1.b/822.1.c 的“可以打到你有单位的战场”）与 conditional " +
    "continuous.timing（该打出许可下的 Reaction 时机），但 play-location-permission 仍缺 822.3 要求的" +
    "Finalize 位置选择/重验消费方，continuous.timing 也仍缺 chain canAct 的消费方（Ambush.ts 文件头把两者" +
    "列为未合入依赖），因此该单位的合法打出位置与 Reaction 时机都不可执行；822.4 的“是否拥有 Ambush 可被" +
    "引用”也依赖同一接线。Play Effect 半段（383.4.a 的 card-played 触发）与“deal damage equal to the damage " +
    "marked on it”（418.1.b/418.1.e + object-property 读取目标 damage）只用已合入原语，golden 用真实解释器" +
    "执行并覆盖 0 伤害边界。依赖：Finalize 位置选择的持续效果消费方与 chain canAct 的时机许可消费方" +
    "（位置选择与时机许可的当前引擎消费缺口）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ambush" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "morgana.damage-equal-to-marked-damage",
          op: "effect.damage",
          args: {
            // 418.1.b / 143.3：“equal to the damage marked on it”——结算时读取被选单位当前
            // 已标记的伤害（契约 3.6 的 object-property + target 选择器）。绝不写死数额。
            amount: {
              kind: "object-property",
              object: { target: "morgana.unit" },
              property: "damage"
            },
            target: { kind: "constant", value: "morgana.unit" }
          },
          targets: [
            {
              // “a unit”：未特别说明时指 Board 上的单位（355.9.a.1、355.10），由控制者在
              // Finalize 选择一个对象，因此是目标而不是 pick。
              id: "morgana.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, deal damage to a unit equal to the damage marked on it."
} satisfies CardProgram;
