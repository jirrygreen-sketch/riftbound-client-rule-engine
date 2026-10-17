import type { CardProgram } from "../../ir/index.js";

/**
 * Heimerdinger, Inventor (ogn-111-298) — Unit, 3 energy + 1 Mind power, Might 3，
 * 标签 Yordle / Heimerdinger / Piltover / Champion。
 *
 * 原文：I have all :rb_exhaust: abilities of all friendly legends, units, and gear.
 *
 * 规则依据（CR v1.5）：
 * - 364.2："I have all …" 是陈述事实的静态（被动）能力。
 * - 479.3 / 479.3.a / 479.3.b：授予、移除或替换 Game Object 能力的效应属于
 *   第 3 层（Ability-Altering Effects）；认定词包括 "have"、"has"、"give"。
 * - 135.2.e.2 / 415.5：":rb_exhaust:" 是横置符号，作为能力里的费用表示
 *   "Exhaust this"；所以被授予的是「以横置自身为费用的启动能力」集合。
 * - "friendly legends, units, and gear" 是集合查询（355.10.d 型，不选择目标），
 *   过滤锚点为对手控制者之外的己方 board 上的 legend / unit / gear。
 *
 * 状态：judge-required。所需能力授予层尚未合入：
 * - 当前静态绑定器只消费已知的 timing/keyword/movement/restrict/combat 等能力层
 *   效果，没有 `continuous.grant-abilities` 的能力正文复制消费者（调研文件
 *   ability-templates.md 第 4 节把能力授予族列为 0/0 已实现的容量）。
 * - 该能力是动态依赖：被授予的是运行时可变的引用集合（每个合法正面对象的
 *   :rb_exhaust: 能力），调研明确要求这类 grant 必须有依赖闭包或显式运行时能力
 *   边界，不能只看本卡出现的词（(ability-templates.md 第 4 节末段）。
 * 下面的静态声明只按契约写出形状，不近似实现（不得用关键词授予或自制跑腿逻辑替代）。
 *
 * 依赖：能力层的运行时能力复制与动态依赖闭包；现有静态绑定接口不足以表达它。
 */
const heimerdingerInventor = {
  canonicalCardId: "card.hash-b7190a8e16c22b4109edaa4eb5b9e4966b3c5224711d5cc7760f15b5a996bef4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I have all :rb_exhaust: abilities of all friendly legends, units, and gear」需要 CR v1.5 479.3 的能力授予层，" +
    "把运行时己方对象的启动能力正文复制到本卡；当前静态绑定器没有 `continuous.grant-abilities` 的 layer 映射或能力复制消费者。" +
    "该效果还是动态依赖（引用集合变化时能力闭包随之变化），不能用关键词授予或单卡逻辑近似。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-abilities",
        appliesTo: "self",
        // 135.2.e.2 / 415.5：横置符号作为启动能力费用的标记。
        cost: "exhaust",
        // 无选择集合（355.10.d）：己方 board 上的 legend / unit / gear。
        filter: {
          zone: "board",
          type: ["legend", "unit", "gear"],
          controller: "self"
        }
      }
    }
  ],
  sourceText: "I have all :rb_exhaust: abilities of all friendly legends, units, and gear."
} satisfies CardProgram;

export default heimerdingerInventor;
