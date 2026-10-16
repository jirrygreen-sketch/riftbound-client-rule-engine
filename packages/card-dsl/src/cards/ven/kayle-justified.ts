import type { CardProgram } from "../../ir/index.js";

/**
 * Kayle, Justified (ven-134-166) — Unit, 3 Energy, 3 Might, Order,
 * Mount Targon/Kayle/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-134-166，逐字）：
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me.)
 *   I can be [Empowered] up to three times.
 *   I have +2 :rb_might: for each time I'm [Empowered].
 *   While I'm [Empowered] three times, I have [Deflect 3] and [Ganking].
 *
 * 规则依据（CR v1.5）：
 * - 827.1/827.1.c.1：[Empower] 是启动能力关键词，功能等价于
 *   “[3 Energy]：Empower me。仅当未 Empowered 时启动。”
 * - 442.1.c.1：部分效果可授予对象“多次 Empower”许可；这类对象忽略 442.1.b 的
 *   常规限制，Empowered 成为可叠加状态（本卡“up to three times”即上限 3 的许可，
 *   effect.empower 的 multiple / limit 参数正是为它准备的）。
 * - 442.2 / 442.2.a：Empowered 状态是可被其他游戏效果读取的状态。
 * - “+2 [M] for each time I'm [Empowered]”：Empowered 次数 × 2 的图层算术修正
 *   （479、contract 3.4）。
 * - 828.1.b/[Deflect 3]/[Ganking]：达到三次后获得的两个关键词（809 Deflect、
 *   810 Ganking），由依赖条件 + 关键词授予表达。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的启动费用无法展开；
 * 2. 没有 Empowered 次数谓词：442.1.c.1 的可叠加状态计数不在 ObjectSnapshot /
 *    Condition 里（静态效果里的 `empoweredCount: 3` / `per-empower` 只是描述性记录）；
 * 3. 没有卡牌侧 continuous.might 的注册/求值入口（RIFT-91 只合入了 layers 引擎）；
 * 4. 没有持续授予关键词的原语（continuous.grant-keyword / continuous.keyword），
 *    “我有 [Deflect 3] 和 [Ganking]”不能由卡程序表达（同 sfd/rumble-hotheaded 缺口）。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）、RIFT-91（layers 接线）。
 */
export default {
  canonicalCardId: "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“3 Energy：Empower me”无法展开；(2) 442.1.c.1 的“可被 Empower 三次”需要可叠加" +
    "状态的计数谓词，Empowered 次数不在 ObjectSnapshot / Condition 里（本程序的 empoweredCount: 3 只" +
    "是描述性记录）；(3) “+2 :rb_might: for each time I'm [Empowered]” 需要卡牌侧的 continuous.might" +
    "图层算术修正与注册入口（RIFT-91 只合入了 layers 引擎）；(4) “[Deflect 3] 和 [Ganking]” 是持续" +
    "授予关键词，需要 continuous.grant-keyword / continuous.keyword 原语（同 rumble-hotheaded 缺口）。" +
    "依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）与 RIFT-91（layers 接线）。不近似实现。",
  abilities: [
    {
      // 印刷费 3 Energy 见 judgeReason；不伪造启动能力。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // 442.1.c.1：本卡拥有“可被 Empower 最多三次”的许可（上限 3）。
      // 静态记录该印刷许可，尚无谓词消费者（描述性字段）。
      kind: "static",
      effect: {
        kind: "empower-limit",
        limit: { kind: "constant", value: 3 },
        appliesTo: "self"
      }
    },
    {
      // “I have +2 [M] for each time I'm [Empowered]”：图层算术修正，
      // 数量 = Empowered 次数 × 2（479、contract 3.4）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        perEmpower: { kind: "constant", value: 2 },
        appliesTo: "self"
      }
    },
    {
      // “While I'm [Empowered] three times, I have [Deflect 3] and [Ganking]”：
      // 持续授予两个关键词；需要 continuous.grant-keyword 原语（见 judgeReason）。
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keywords: [
          { id: "Deflect", value: 3 },
          { id: "Ganking" }
        ],
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: {
          kind: "object-property",
          object: "self",
          property: "empoweredCount"
        },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me.)\n" +
    "I can be [Empowered] up to three times.\n" +
    "I have +2 :rb_might: for each time I'm [Empowered].\n" +
    "While I'm [Empowered] three times, I have [Deflect 3] and [Ganking]."
} satisfies CardProgram;
