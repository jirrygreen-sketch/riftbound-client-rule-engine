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
 * 状态：judge-required（复核 2026-10-18）。当前缺口：
 * 1. programs/statics.ts 的 staticTarget 拒绝动作级 appliesTo
 *    "controller-spells-and-abilities"；去掉该字段后，layerFor 仍拒绝
 *    continuous.bonus-damage，layers/ 也没有该效果的消费分支。
 * 2. effect.damage 只读取调用方的 args.bonus，没有按控制者收集、叠加并消费静态
 *    Bonus Damage 授予的路径（418.4/418.5、712-715）；也没有同名授予 opcode。
 *    单卡测试证明手动给定 bonus 时每目标加成（715.2）、分摊前加总（715.3）及
 *    负数不生效（714.2），这些仅为伤害子效果证据，不证明本卡的持续授予。
 * 本文件保留契约 3.1 的 static 形状描述，不把 Bonus Damage 改写为替代效果。
 *
 * 依赖：Bonus Damage 授予效果的 opcode（continuous.bonus-damage）、layers/statics
 * 的 action-scope 映射，以及把授予结果注入每次 Deal 的消费方。
 */
export default {
  canonicalCardId: "card.hash-cb7e947fa0684712ff2e8dbc8148eaa39687afa9028c093d407a3dc1f84712a5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.bonus-damage 的生产授予路径：programs/statics.ts 的 staticTarget 拒绝 " +
    "appliesTo: controller-spells-and-abilities；去掉 appliesTo 后 layerFor 仍无该效果的图层映射，" +
    "layers/ 无消费分支，也无同名授予 opcode。effect.damage 仅消费调用方传入的 args.bonus，" +
    "缺按控制者收集、叠加静态授予并注入每次 Deal 的消费者（CR 418.4/418.5、712-715）。" +
    "所需语义包含每目标分别增加（715.2）、分摊前增加总量（715.3）及无 Deal 时不适用（715.4）；" +
    "不能用对象 filter 或伤害替代效果近似动作级 Bonus Damage。",
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
