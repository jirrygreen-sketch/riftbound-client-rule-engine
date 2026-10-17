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
 * status 判定（cards/README.md 第 2 节）：judge-required。复核（2026-10-17，
 * RIFT-613 第三轮 M2 覆盖率复核）：Empower/Empowered KeywordDef 已合入
 *（effects/keywords/Empower.ts，RIFT-593）；continuous.might 与 continuous.grant-keyword
 * 原语、静态效果→layers 的注册路径（programs/statics.ts 的 createEngineStaticBinder，
 * attachProgramLifecycle 缺省使用它）都已合入，test.mjs 的 probe 覆盖了各静态的绑定行为。
 * 仍缺的是印刷费用承载通道、可叠加 Empowered 状态的图层谓词与对象侧许可读取、
 * per-Empower 图层求值、Deflect/Ganking 的生产消费方，见 judgeReason。
 */
export default {
  canonicalCardId: "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 RIFT-613 复核实测）：(1) Empower/Empowered 关键词已合入" +
    "（effects/keywords/Empower.ts，RIFT-593），但印刷费用没有承载通道：KeywordAbility 只有 " +
    "keyword/value，expandProgram 只传 value/host，实测本卡展开出的 activated.cost 是 " +
    "{ kind: \"empower\" }（不含 3 Energy），describeActivate 以 \"Unsupported cost kind empower\" 拒绝。" +
    "(2) 442.1.c.1『可被 Empower 三次』仍缺对象侧许可读取方与计数谓词：effect.empower 的 " +
    "multiple/limit 参数已存在，但没有任何图层/关键词侧持有并读取该 per-object 许可，" +
    "静态 empower-limit 本身在 programs/statics.ts 被拒（\"Static ability kind empower-limit " +
    "has no layer mapping\"）；ObjectSnapshot（effects/contract.ts）也不声明 Empowered 计数，" +
    "实测 object-property \"empoweredCount\" 抛 MissingInformation、静态门条件捕获后为 false。" +
    "(3)『+2/每次』没有消费方：continuous.might 能绑定进 layers，但 arithmetic 层只读 " +
    "amount/value/delta，不读 perEmpower，实测 Kayle 的 Might 恒为 3；continuous.grant-keyword " +
    "能注册 [Deflect 3] / [Ganking] 的 ability 层，但计数门条件依赖缺口 (2) 且 Deflect 的 " +
    "target.tax / Ganking 的移动许可都没有生产消费方。依赖可叠加 Empowered 状态的图层谓词与" +
    "对象侧许可读取、印刷费用承载通道。不近似实现。",
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
