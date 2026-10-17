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
 * continuous.might（RIFT-258）与 continuous.grant-keyword（RIFT-258）两句原语已合入，
 * 卡牌能力形态（static + condition）与契约 3.7 一致；但本卡仍 judge-required，
 * 因为静态效果没有可执行的三条链路：
 * 1. 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的“3 Energy：Empower me”与
 *    827.1.c.5 的“仅当未 Empowered 时启动”无法展开（keywords/registry.generated.ts
 *    的 26 个已注册关键词里没有它们）；
 * 2. 442.1.c.1 的“可被 Empower 三次”是可叠加状态的计数谓词：Empowered 次数不在
 *    ObjectSnapshot，Condition/HistoryQuery 也没有该谓词；effect.empower 的
 *    multiple/limit 参数虽已存在，却没有对象侧许可的读取方，程序里的 empoweredCount
 *    只是描述性记录；
 * 3. 静态能力没有进入 layers 的注册方：RIFT-257 的 attachProgramLifecycle 只把
 *    static/replacement 交给调用方提供的 binder（noopStaticBinder 是缺省值），
 *    engine-core 内没有把 continuous.might / continuous.grant-keyword 的静态数据转成
 *    ctx.addContinuous 注册的实现；且 layers 的 valueOf 不处理 perEmpower / count
 *    形状（会得到 0），condition 也不识别 empoweredCount 这类特征读取。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）与 RIFT-257（静态效果
 * → layers 的注册接线）。
 */
export default {
  canonicalCardId: "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“3 Energy：Empower me”无法展开；(2) 442.1.c.1 的“可被 Empower 三次”需要可叠加" +
    "状态的计数谓词，Empowered 次数不在 ObjectSnapshot / Condition 里（本程序的 empoweredCount: 3 只" +
    "是描述性记录）；(3) 三条 static 效果（continuous.might 的 per-Empower 修正与 " +
    "continuous.grant-keyword 的 [Deflect 3] / [Ganking] 授予）虽有已合入（RIFT-258）的原语与图层引擎，" +
    "但没有静态效果进入 layers 的注册方：RIFT-257 的 attachProgramLifecycle 只把 static 交给调用方的 " +
    "binder（缺省 noopStaticBinder），engine-core 内没有将 static 数据转成 ctx.addContinuous 的实现，" +
    "且 layers 的 valueOf 不处理 perEmpower/count 形状（会得到 0）、condition 不识别 empoweredCount 谓词。" +
    "依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）与 RIFT-257（静态效果→layers 注册接线）。" +
    "不近似实现。",
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
