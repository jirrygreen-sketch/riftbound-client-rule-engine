import type { CardProgram } from "../../ir/index.js";

/**
 * Annie, Fiery (ogs-001-024) — Unit, 5 energy / 1 power (Fury), Might 4.
 *
 * sourceText (deck-catalog.json, ogs-001-024, verbatim):
 *   "Your spells and abilities deal 1 Bonus Damage. (Each instance of damage
 *   the spell deals is increased by 1.)"
 *
 * 规则依据（CR v1.5）：
 * - 418.4/418.5：Dealing 可带有 Bonus Damage 这一内在属性；712 定义 Bonus
 *   Damage；713 说明它附加在 Deal 动作上改变分配总量。
 * - 714/714.1：多个 Bonus Damage 相加并只应用一次，且只能为正数；714.2 负数
 *   不生效；715/715.1/715.2：多目标时每个目标分别增加；715.3 分摊伤害先加总；
 *   715.4 没有造成伤害则不适用。
 * - "Your spells and abilities"：授予范围是本控制者的法术与能力（418.6.b.2 能力
 *   可作为 Deal 的来源）。
 *
 * 状态：judge-required。已合入的 effect.damage 只在结算时做 Bonus Damage 的
 * 加总与施加（714/715），其文件头明确把"授予来源"交给持续效果/图层系统：
 * "Bonus Damage 的来源授予（如 Annie, Fiery ...）由持续效果/图层系统算好后经
 * bonus 表达式传入"。当前 effects/instructions/ 与 layers/ 都没有消费
 * "给本控制者的法术与能力授予 +1 Bonus Damage" 的持续效果实现（没有已注册的
 * continuous.* op，图层注册管线也未接卡牌静态能力），因此不能声称整卡可执行；
 * 本文件只按契约 3.1 的 static 形状描述该持续效果，不做近似实现。
 *
 * 依赖：RIFT-91（layers-continuous：持续效果注册与消费）、伤害管线接入该授予。
 */
export default {
  canonicalCardId: "card.hash-cb7e947fa0684712ff2e8dbc8148eaa39687afa9028c093d407a3dc1f84712a5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺持续效果消费方：为你的法术与能力授予 1 Bonus Damage 需要图层系统把 +1 Bonus Damage " +
    "授予本控制者所有法术/能力造成的 Deal 动作，而 effect.damage 文件头明确只负责 " +
    "714 的加总与 715 的施加，授予来源属持续效果/图层（CR 712-715、418.4/418.5）；" +
    "effects/instructions/ 与 layers/ 当前都没有该持续效果的注册/消费实现。" +
    "依赖：RIFT-91（layers-continuous）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.bonus-damage",
        amount: { kind: "constant", value: 1 },
        appliesTo: { kind: "constant", value: "controller-spells-and-abilities" },
        filter: { type: ["spell", "ability"], controller: "controller" }
      }
    }
  ],
  sourceText:
    "Your spells and abilities deal 1 Bonus Damage. (Each instance of damage the spell deals is increased by 1.)"
} satisfies CardProgram;
