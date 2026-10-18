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
 * status 判定（cards/README.md 第 2 节）：judge-required。复核（2026-10-18）：
 * Empower/Empowered KeywordDef、continuous.might、continuous.grant-keyword 以及
 * 静态效果到 layers 的注册路径均已合入并有局部执行证据。仍缺印刷费用承载、
 * 多次 Empower 许可与计数的生产读取、per-Empower 图层求值，以及授予后的
 * Deflect/Ganking 生产消费接线，见 judgeReason。
 */
export default {
  canonicalCardId: "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口，均不近似实现：(1) 827.1.c.1 的印刷 3 Energy 没有费用承载通道：" +
    "KeywordAbility 只有 keyword/value，expandProgram 只传 value/host，实测本卡展开出的 " +
    "activated.cost 是 { kind: \"empower\" }，describeActivate 以 \"Unsupported cost kind empower\" 拒绝。" +
    "(2) 442.1.c.1 的多次 Empower 许可没有生产读取方：effect.empower 已支持 multiple/limit，" +
    "但 empower-limit 在 programs/statics.ts 绑定时抛 \"Static ability kind empower-limit has no layer mapping\"；" +
    "生产 ObjectSnapshot 也不声明 empowered 计数，三次门控对 object-property \"empowered\" 的读取以 " +
    "MissingInformation 失败闭合。(3) per-Empower 算术与授予关键词没有完整消费方：" +
    "continuous.might 只消费 amount/value/delta，实测 perEmpower 不改变 Might；" +
    "continuous.grant-keyword 能登记 [Deflect 3]/[Ganking]，但授予后的 target.tax 与" +
    "battlefield-to-battlefield 移动许可没有接入默认 CardProgram/ChainEngine 消费路径。",
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
          property: "empowered"
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
