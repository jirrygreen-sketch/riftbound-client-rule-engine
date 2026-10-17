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
 * 复核（2026-10-16 第一轮复核）：
 * - `replacement.enter`/`effect.ready` 的入场替代（RIFT-260 的 src/replacement/ + bindReplacement）
 *   已合入：本卡的 static replaces 体（单条自指 effect.ready）按 RIFT-260 的“表单 2”绑定，
 *   golden 用真实 replacement 绑定 + ChainEngine 打出执行就绪入场并断言不产生 object-readied。
 * - 缺口：没有已合入路径把 CardProgram 的 replacement/keyword 能力注册进生产（RIFT-257），
 *   且 Disarm 展开所需的 attack-declared 时点与一致的行动事务仍未生产（combat/flow.ts 明确
 *   抛 combat-start-transaction；见 docs/rules/timing-point-producers.md）。
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
    "两处当前缺口：(1) 没有已合入路径把 CardProgram 的 replacement / keyword 能力注册进生产" +
    "（RIFT-257 卡牌程序绑定）：入场替代（replacement.enter + effect.ready，RIFT-260 的 src/replacement/ + " +
    "bindReplacement 已合入，golden 已用真实绑定 + ChainEngine 执行就绪入场）与 [Disarm 2] 的展开体" +
    "（effects/keywords/Disarm.ts 已合入，RIFT-267）目前都只能由测试侧显式绑定。" +
    "(2) [Disarm 2] 的攻击触发依赖 attack-declared 时点（CR 831.1.d / 466.2.c），该时点尚无生产者：" +
    "combat/flow.ts 的角色事务明确抛 combat-start-transaction（docs/rules/timing-point-producers.md 标为待后续），" +
    "815/831 类的战斗指派与身份也仍缺契约 3.8 combatRole 的落地。不近似实现。",
  abilities,
  sourceText:
    "I enter ready if you control no other units.\n" +
    "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)"
} satisfies CardProgram;

export default program;
