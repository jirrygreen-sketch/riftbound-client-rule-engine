import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Serene Ascetic (ven-030-166) — Unit, Calm, 3 Energy, Might 3, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-030-166，逐字）：
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay
 *   :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，印刷费用 3 Energy，
 *   功能等价于 “[3 Energy]：Empower me。仅当未 Empowered 时启动。” 按契约 3.7
 *   卡牌只声明关键词身份，展开归 effects/keywords/<keyword>.ts。
 * - 827.1.b / 827.1.b.1：Empower 的来源（“me”）就是能力来源自身，不是目标。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c：“[Empowered][>]” 之后的整句是依赖能力，
 *   只在宿主拥有 Empowered 状态时 Active；[Text] 是 “I have [Deflect] and [Shield 3]”。
 * - 809.1 / 809.1.b.3：省略 Deflect Value 时按 1 处理；809.1.c/809.1.c.1 的功能文本
 *   让对手选择我时额外支付任意域 Power。
 * - 814.1 / 814.1.b.3 / 814.1.c：[Shield 3] 是本印刷写明的数值 3，功能等价于
 *   “当我是防守者时 +3 Might”；展开同样归 keywords/Shield.ts。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，
 *    827.1.c.1 的“3 Energy：Empower me，仅当未 Empowered 时启动”无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a 的二元状态）——“[Empowered][>]” 的门控
 *    没有可求值形态；
 * 3. “[Deflect] 和 [Shield 3]” 是持续授予关键词：programs/statics.ts 的
 *    createEngineStaticBinder().bindStatic 已能把该声明装进 ability 图层并在快照里
 *    写出 deflect 1 / shield 3（golden 有执行证据）；被授予的 Deflect 还需要
 *    target.tax 图层消费方——当前没有模块在对该宿主的 target 声明里读并收取该税。
 * 依赖：新增 Empower/Empowered 关键词任务、Empowered 状态谓词（RIFT-359 的谓词任务进行中）与
 * Deflect 目标税消费（RIFT-360 进行中）。本卡不伪造启动能力，也不把依赖能力写成无条件能力。
 */
const abilities: Ability[] = [
  {
    // 827.1.c.1：印刷费 3 Energy 见 judgeReason；KeywordAbility 没有 params 字段
    // （契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower",
    value: 3
  },
  {
    // 828.1.b.1 的依赖能力：只在宿主拥有 Empowered 状态时授予 [Deflect] 与 [Shield 3]。
    // 关键词展开由已合入的 Deflect.ts / Shield.ts 负责（809.1.b.3 省略数值按 1；
    // 本印刷写明的 Shield 数值是 3）。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "shield", value: 3 }
      ]
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-e5195b063794caf45ca0ef55353be70e2a69d150511f33bccf7dfe8ae729254b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“3 Energy：Empower me，仅当未 Empowered 时启动”无法展开（827.1.b.1 还要求" +
    "来源不是目标）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / " +
    "Condition 里，“[Empowered][>]” 的依赖能力门控（828.1.b.1 / 828.1.c）没有可求值形态；" +
    "(3) “[Deflect] 和 [Shield 3]” 是持续授予关键词：programs/statics.ts 的 " +
    "createEngineStaticBinder().bindStatic 已能把该声明装进 ability 图层，图层快照真实写出 " +
    "deflect 1 / shield 3（golden 有执行证据）；剩余执行缺口是被授予的 Deflect " +
    "需要 target.tax 图层消费方（RIFT-360 进行中）。" +
    "依赖新的 Empower/Empowered 关键词任务、Empowered 状态谓词（RIFT-359 进行中）与 Deflect 目标税消费 " +
    "（RIFT-360 进行中）。不近似实现：不伪造启动能力，不把依赖能力写成无条件能力。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
