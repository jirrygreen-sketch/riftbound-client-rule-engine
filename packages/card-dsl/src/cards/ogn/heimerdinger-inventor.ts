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
 * - 冻结 IR 的 ContinuousEffect 只有开放 kind/value 形状，没有任何消费者实现
 *   「复制/授予被引用对象的能力正文」（RIFT-258/259 能力授予层；调研文件
 *   ability-templates.md 第 4 节把 continuous.keyword 的“授予 / 移除能力或标签”
 *   列为 0/0 已实现的容量）。
 * - 该能力是动态依赖：被授予的是运行时可变的引用集合（每个合法正面对象的
 *   :rb_exhaust: 能力），调研明确要求这类 grant 必须有依赖闭包或显式运行时能力
 *   边界，不能只看本卡出现的词（(ability-templates.md 第 4 节末段）。
 * 下面的静态声明只按契约写出形状，不近似实现（不得用关键词授予或自制跑腿逻辑替代）。
 *
 * 依赖：RIFT-258/259（能力授予层的缺失语义）与 RIFT-257（CardProgram 静态能力绑定）。
 */
const heimerdingerInventor = {
  canonicalCardId: "card.hash-b7190a8e16c22b4109edaa4eb5b9e4966b3c5224711d5cc7760f15b5a996bef4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I have all :rb_exhaust: abilities of all friendly legends, units, and gear」需要能力授予层（CR v1.5 479.3 第 3 层：" +
    "授予 / 移除 / 替换能力），把被引用对象的启动能力复制到本卡；当前合入的 continuous.keyword / continuous.grant-keyword 只处理关键词标记，" +
    "没有能力正文复制消费者，ability-templates.md 第 4 节把能力授予族列为 0/0 容量。" +
    "该效果还是动态依赖（运行时引用集合的能力闭包），调研要求其必须有依赖闭包或显式运行时能力边界，" +
    "不得以关键词授予或单卡逻辑近似。依赖：RIFT-258/259（能力授予层）与 RIFT-257（CardProgram 静态能力绑定）。",
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
