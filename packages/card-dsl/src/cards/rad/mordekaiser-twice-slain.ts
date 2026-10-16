import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mordekaiser, Twice Slain (rad-020-167) — Unit, 7 energy, 1 power (Fury), 5 Might,
 * tags Noxus/Mordekaiser/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-020-167）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me
 *   enter ready.)
 *   [Assault 3] (+3 :rb_might: while I'm an attacker.)
 *   Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and
 *   recall me instead.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1 / 805.1.b / 805.1.b.1 / 805.2.b）：可选附加费用关键词，此处力量
 *   部分只能用与单位某一域（Fury）匹配的力量支付；展开由 effects/keywords/Accelerate.ts
 *   负责，卡文件只声明关键词（契约 3.1/3.7）。
 * - [Assault 3]（807.1.b.1/.b.2 的数值形式、807.1.c 的 “+3 while attacker”、807.1.d
 *   的 designation 时效）：展开由 effects/keywords/Assault.ts 负责。
 * - “Once each turn, if I would die … instead”：替代效果（369.1 的 “would … instead”
 *   结构、369.3 类比对入场替代的描述）；“you may …” 是替代效果本身的可选决定，
 *   不是替代体内部的一条指令；被替代的对象不是目标（355.10.c / 355.10.c.1：只作为费用、
 *   触发条件或替代效果组成部分的选择不选目标）。
 * - 替代体的动作：kill（429.1 / 429.1.a.1 / 429.3 主动消灭）→ heal（419.1）→ exhaust
 *   （415.1；本卡写的是效果型横置）→ recall（457 从任意处回到 Base 且不是 Move；458.3
 *   不能被移动限制阻止；460.1 除特别说明外不改变状态）。"kill a friendly unit to heal me"
 *   按 355.10.c.1 是费用式动作（“[do X] to [do Y]”），不是目标选择。
 *
 * status = judge-required（见 judgeReason）：三处 IR 缺口，不近似实现：
 * 1. 替代效果的可选性：IR 的 ReplacementAbility 没有 optional 字段；把 "you may" 写成
 *    替代体内部的 choice.optional 会在玩家拒绝时仍然替代死亡，语义错误（同 The Boss
 *    ogn-269-298 的判定）。
 * 2. “kill a friendly unit” 是替代体内的费用式动作（355.10.c.1），需要不选目标的
 *    filter 式费用选择；CostSpec 的 choice 目前只接受逐项列出的精确 ObjectRef
 *    （cost/plan-values.ts 的 choiceObjects），静态卡程序无法写出（同 Garbage Grabber
 *    ogn-099-298 的缺口）。
 * 3. recall 没有可执行动作：effect.move 的 mode "recall" 被原语显式阻断
 *    （“Recall requires an action distinct from Move (CR v1.5 457-460)”）。
 * 另：“Once each turn” 需要替代效果的一次性/每回合频率记账，卡牌级替代效果也还没有
 * 已合入的注册路径（事件/链层的 registerReplacement 只有引擎内部调用方）。
 * 依赖：RIFT-89（cost.pay / 费用计划）、RIFT-109（recall 动作）、RIFT-120（替代注册管线）、
 * RIFT-81/86（Assault/Accelerate 展开落地）、RIFT-91（图层接线）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "assault", value: 3 },
  {
    kind: "replacement",
    // “if I would die” — 被替代事件是来源单位被消灭（429.1.a.1；死亡替代在
    // 替代处理后、实际换区前收集）。
    replaces: { event: "object-killed", filter: { source: "self" } },
    with: [
      {
        // “kill a friendly unit” — 费用式动作，按 355.10.c.1 不是目标，因此用 picks
        // （非目标选择）而不是 targets；静态 IR 只能给出描述性选项，Finalize 期的
        // 具体引用由（尚未合入的）费用/替代适配器提供。
        id: "mordekaiser.kill-friendly",
        op: "effect.kill",
        args: { picks: { kind: "constant", value: "mordekaiser.friendly-unit" } },
        picks: [
          {
            id: "mordekaiser.friendly-unit",
            options: ["friendly-unit-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "unit", zone: "board", controller: "controller", other: true }
          }
        ]
      },
      {
        // “heal me” — effect.heal 的缺省选择就是能力来源（419.1 清除标记伤害）。
        id: "mordekaiser.heal-self",
        op: "effect.heal",
        args: {},
        linkedTo: "mordekaiser.kill-friendly"
      },
      {
        // “exhaust me” — 效果型横置（415.1）。用非目标选择（choose）加 source 过滤锚点
        // 表达“来源自己”，不把自身写成目标（355.10.c）。
        id: "mordekaiser.exhaust-self",
        op: "effect.exhaust",
        args: {
          choose: {
            kind: "constant",
            value: { id: "mordekaiser.exhaust-me", filter: { source: "source" } }
          }
        },
        linkedTo: "mordekaiser.heal-self"
      },
      {
        // “and recall me instead” — 457/458/458.3/460.1：Recall 不是 Move，不能被移动
        // 限制阻止，也不改变状态；effect.move 的 recall 模式目前显式阻断。
        id: "mordekaiser.recall-self",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: "source" },
          to: { kind: "constant", value: "controller-base" },
          mode: { kind: "constant", value: "recall" }
        },
        linkedTo: "mordekaiser.exhaust-self"
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-f7168f36176ada340afa90fee63698e923fee7c44c455b65ba0fa4cf1b747c7e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "替代死亡的三段缺口（CR v1.5 369.1/369.3、355.10.c.1、457-460）：" +
    "(1) 印刷的 \"you may … instead\" 是替代效果本身的可选决定，但 IR 的 ReplacementAbility 没有 optional 字段；" +
    "写成替代体内部的 choice.optional 会在玩家拒绝时仍然替代死亡（同 The Boss ogn-269-298），不近似实现；" +
    "(2) \"kill a friendly unit\" 是替代体内的费用式动作（355.10.c.1 明确不计为选目标），需要不选目标的 filter 式费用选择，" +
    "而 CostSpec.pick 只接受逐项精确 ObjectRef（cost/plan-values.ts choiceObjects），静态卡程序无法写出，" +
    "cost.sacrifice / cost.pay 亦未合入（RIFT-89）；" +
    "(3) recall 无动作：effect.move 的 mode \"recall\" 被显式阻断（Recall requires an action distinct from Move，CR 457-460），" +
    "不能用普通 move-location 或离区再入场近似（458.3/460.1），依赖 RIFT-109。" +
    "另：\"Once each turn\" 的每回合一次性频率与卡牌级替代效果注册路径未接线（事件/链层 registerReplacement 只有引擎内部调用方，RIFT-120）。" +
    "keyword 部分：[Accelerate]（805）与 [Assault 3]（807.1.c/.d）的 KeywordDef 已合入（RIFT-81/86），" +
    "但卡牌 keyword 能力→展开→图层注册的生产方仍缺（RIFT-91），Attacker designation 也还不是 ObjectSnapshot 特征。" +
    "已知可执行部分：替代体前三条指令中的 effect.kill / effect.heal / effect.exhaust 均为已合入原语。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
    "Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead."
} satisfies CardProgram;

export default program;
