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
 * 状态：judge-required（复核 2026-10-17）。production static binder
 * （programs/statics.ts 的 createEngineStaticBinder 已接线，chain 生命周期会自动绑定
 * static 能力）确实已被合入，但本卡连注册都过不去，两处缺口都是当前的：
 * 1. layerFor 只把 kind 含 might/buff、copy、type/tag/trait、timing/keyword/
 *    movement/restrict/combat 的静态效果映射到图层；`continuous.bonus-damage`
 *    不含这些词，bindStatic 直接抛 "Static ability kind continuous.bonus-damage has no
 *    layer mapping"（golden 实测 ProgramBindingError）。效果种类本身既没有
 *    opcode 文件，也没有 layers/ 的消费分支。
 * 2. staticTarget 只接受 appliesTo 为 self/source 选择符或 filter；本卡的
 *    "给本控制者的法术与能力" 是动作级作用域，即使删掉 appliesTo 也会
 *    抛 "Static ability kind continuous.bonus-damage has no layer mapping"，而
 *    保留 appliesTo 时抛 "Unsupported static appliesTo ..."——效果应施加在
 *    Deal 动作（418.4/418.5、712-715）而不是对象上。
 * effect.damage 只消费调用方传入的 bonus 表达式（714/715.2 的加总与逐目标施加已在
 * golden 证明），它不做授予，也没有把 static 授予结果注入每次 Deal 的消费方。
 * 本文件保留契约 3.1 的 static 形状描述，不做近似实现。
 *
 * 依赖：Bonus Damage 授予效果的 opcode（continuous.bonus-damage）、layers/statics
 * 的 action-scope 映射，以及把授予结果注入每次 Deal 的消费方。
 */
export default {
  canonicalCardId: "card.hash-cb7e947fa0684712ff2e8dbc8148eaa39687afa9028c093d407a3dc1f84712a5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "production static binder 已合入（programs/statics.ts 的 createEngineStaticBinder，由 chain 生命周期绑定），" +
    "本卡仍在注册阶段失败，缺口有二：(1) layerFor 没有 continuous.bonus-damage 的图层映射，" +
    "bindStatic 抛 \"Static ability kind continuous.bonus-damage has no layer mapping\"；" +
    "(2) staticTarget 只接受对象选择符，本卡的授予作用域是 Deal 动作（CR 418.4/418.5、712-715），" +
    "无法只写成对象 filter。effect.damage 的消费端（714 加总、715.2 每目标分别增加、714.2 非正不生效）" +
    "已有执行测试，但没有任何生产消费者把该 static 授予注入每次 Deal，效果种类也没有 opcode。" +
    "通用测试台实测确认：绑定先被 staticTarget 拒绝（Unsupported static appliesTo " +
    "\"controller-spells-and-abilities\"，尚未走到 layerFor），且同一场景里 Hextech Ray 只造成印刷的 3 点伤害。" +
    "依赖：continuous.bonus-damage 的 opcode 与 layers 的 action-scope 映射，以及伤害管线的授予消费方。" +
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
