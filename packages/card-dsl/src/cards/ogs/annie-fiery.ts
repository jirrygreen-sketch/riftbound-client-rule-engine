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
 * 状态：judge-required。RIFT-258 合入了 continuous.might / grant-keyword /
 * keyword / combat 四个持续效果指令，但其中没有 Bonus Damage 的授予形态：
 * "给本控制者的法术与能力授予 +1 Bonus Damage" 既不是 continuous.might 的
 * Might 算术，也不是 grant-keyword 的关键词授予（712-715 定义 Bonus Damage 是
 * 附加在 Deal 动作上的伤害属性），effect.damage 的文件头仍明确由"持续效果/图层
 * 系统算好后经 bonus 表达式传入"。当前 layers/ 与 effects/instructions/ 都没有
 * 注册/消费该授予（continuous.bonus-damage 没有 opcode 文件），也没有把静态
 * 能力的授予结果注入每次 Deal 的消费方，因此不能声称整卡可执行；本文件只按契约
 * 3.1 的 static 形状描述该持续效果，不做近似实现。
 *
 * 依赖：Bonus Damage 授予原语（continuous.bonus-damage 形态）与伤害管线的授予消费方；
 * 静态能力的注册路径本身也仍待 RIFT-257。
 */
export default {
  canonicalCardId: "card.hash-cb7e947fa0684712ff2e8dbc8148eaa39687afa9028c093d407a3dc1f84712a5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Bonus Damage 授予原语与消费方：RIFT-258 的四个持续效果指令（continuous.might / " +
    "grant-keyword / keyword / combat）都不表达“给本控制者的法术与能力授予 +1 Bonus Damage”" +
    "——Bonus Damage 是附加在 Deal 动作上的伤害属性（CR 712-715、418.4/418.5），不是 Might 算术，" +
    "也不是关键词授予；effect.damage 文件头明确由持续效果/图层系统算好后经 bonus 表达式传入，" +
    "而 effects/instructions/ 下没有 continuous.bonus-damage 的 opcode 文件，layers/ 与伤害管线" +
    "也没有把静态能力的授予结果注入每次 Deal 的消费方（RIFT-258 未覆盖该形态）。" +
    "静态能力的注册路径本身同样仍待 RIFT-257。依赖：Bonus Damage 授予原语与伤害管线消费方、RIFT-257。" +
    "不近似实现。",
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
