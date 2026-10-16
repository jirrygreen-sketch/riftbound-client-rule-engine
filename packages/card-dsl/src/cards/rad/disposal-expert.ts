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
 *   用 count + filter{ controller: controller, other: true, zone: board }，
 *   与 breakneck-mech 的写法同型。
 * - [Disarm 2]：831 的攻击触发关键词（831.1.c/.d："When I attack, give an enemy unit
 *   here -X [M] this turn."），以带数值的 keyword 能力声明（831.2 的求和/合并由
 *   关键词注册表负责）；其展开需要临时 Might 修正（continuous.might）。
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
        filter: { type: "unit", controller: "controller", zone: "board", other: true }
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
    "两处依赖未合入：(1) 「I enter ready」是入场替代（359.2.c 的单位横置进场被替代为就绪进场），" +
    "当前没有已合入的入场替代管线（replacement.enter 系列）执行 object-enters-board 的替代，" +
    "参考 breakneck-mech 的同类结论；with 体内的 effect.ready 原语本身已合入并在 golden 测试中真实执行。" +
    "(2) [Disarm 2]（CR 831：攻击触发 + 给此处一个敌方单位 -2 [M] this turn）尚无已合入 KeywordDef，" +
    "且其展开需要临时 Might 修正（continuous.might，RIFT-91；minimum 0 钳制属 122.5.b），不近似实现。" +
    "依赖：RIFT-91、RIFT-89（替代/费用管线）、831 的关键词任务。",
  abilities,
  sourceText:
    "I enter ready if you control no other units.\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
