import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Disposal Expert (rad-093-167) — Unit, 4 energy, Might 3, Fury。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   I enter ready if you control no other units.
 *   [Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 单位默认横置进场（359.2.c），"I enter ready" 是入场事件的**替代效果**
 *   （359.2.c / 369.3），不能用 effect.ready 事后重置模拟：契约把入场替代写成
 *   { kind: "replacement", replaces: 入场事件, with: ... }。参考同型先例
 *   sfd/breakneck-mech.ts（"I enter ready if you control another Mech."）。
 * - "if you control no other units"：条件比较 controller 的其它单位数量为 0，
 *   用 count + filter{ type: unit, controller: self, zone: board, exclude: self }。
 *   `exclude` 是契约 3.6 的 ObjectFilter 锚点（与 ogn/gemcraft-seer 同型）；
 *   早期写的 `other: true` 只是卡牌侧占位词，已合入的过滤器不解析它。
 * - [Disarm 2]：831 的攻击触发关键词（831.1.c/.d："When I attack, give an enemy unit
 *   here -X [M] this turn."），以带数值的 keyword 能力声明（831.2 的求和/合并由
 *   关键词注册表负责）；其展开所用 effects/keywords/Disarm.ts 与 continuous.might
 *   均已合入（RIFT-267 / RIFT-258）。
 *
 * 复核（2026-10-17 第二轮复核）：
 * - 入场替代（RIFT-260 的 src/replacement/ + bindReplacement）已合入：本卡的 static replaces 体
 *   （单条自指 effect.ready）按其“表单 2”绑定，golden 用真实 replacement 绑定 + ChainEngine
 *   打出，执行就绪入场并断言不产生 object-readied（CR 369.3）。
 *   注意（引擎侧缺口，未在卡数据里绕过）：表单 2 的 entry 声明路径不做能力 `condition` 求值
 *   （bind.ts 的 matchesEnterAction 提前返回 true），故“if you control no other units”这道门
 *   目前不会被执行；表单 3（replacement.event）虽在匹配时求值 condition，但其 `instead` 参数
 *   在 bind.ts 里按原始数组读取，而卡牌 IR 校验器要求 args 是 Expr，卡牌侧写不出该形态。
 *   两条路径的 CardProgram 注册已合入；当前仍需修复 form-2 entry 声明对 ability condition
 *   的匹配，并补齐 Disarm 展开所需的运行时地点过滤与攻击行动事务。
 *   815/831 类的战斗指派与身份也仍缺契约 3.8 combatRole 的落地。不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self" }
    },
    with: [
      {
        id: "disposal-expert.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ],
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "unit",
            // 契约 3.6 的 exclude 锚点："no other units" = 除自身外的己方单位数为 0。
            filter: { type: "unit", controller: "self", zone: "board", exclude: "self" }
      },
      operator: "eq",
      right: { kind: "constant", value: 0 }
    }
  },
  { kind: "keyword", keyword: "disarm", value: 2 }
];

const program = {
  canonicalCardId: "card.hash-b23b662b4d812531660baae2b9e4fc78660d2955cd85f9595e0a61e14f5ea7a0",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口：(1) 入场替代的 CardProgram 绑定已合入（replacement.enter + effect.ready，RIFT-260 的 " +
    "src/replacement/ + bindReplacement 已合入，golden 已用真实绑定 + ChainEngine 执行就绪入场），但 form-2 " +
    "entry 声明路径仍不求值 ability condition，故‘no other units’门槛无法生效（依赖 RIFT-359 条件消费）。" +
    "(2) [Disarm 2] 的攻击触发虽然有 attack-declared 时点与关键词展开（RIFT-267），但 target filter 的 " +
    "sameLocationAs 仍没有运行时地点过滤器（RIFT-357），且 815/831 类的战斗指派与身份仍缺契约 3.8 combatRole 的落地。" +
    "不近似实现",
  abilities,
  sourceText:
    "I enter ready if you control no other units.\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
