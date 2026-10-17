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
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const abilities: Ability[] = [
  {
    // 827.1.c.1：印刷费 3 Energy 见 judgeReason；KeywordAbility 没有 params 字段
    // （契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
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
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-e5195b063794caf45ca0ef55353be70e2a69d150511f33bccf7dfe8ae729254b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（对应 827.1.c.1、828.1.b.1）：(1) Empower KeywordDef 已注册并支持未 Empowered 限制，" +
    "但 KeywordAbility / programs/keywords.ts 不传递本卡印刷的 3 Energy CostSpec，无法建立完整启动费用计划；" +
    "(2) “[Empowered][>]” 门控已改为 self.empowered >= 1，参考内核可求值，但生产 ObjectSnapshot 尚未声明 " +
    "live empowered 计数；" +
    "(3) Deflect/Shield 的 continuous.grant-keyword 持续授予关键词静态绑定（bindStatic）与两项 KeywordDef 展开已合入，" +
    "但授予后的关键词没有随图层变化重新展开绑定，Shield 展开读取的 designation 与公开 combatRole 仍不一致；" +
    "target.tax 也不是 programs/statics.ts layerFor() 支持的图层，且没有把该 Deflect 税自动接入目标 Finalize。" +
    "RIFT-672 模板已验证原始门控的持续授予关键词与撤销，不能证明 Shield 战斗加值或 Deflect 税已执行。" +
    "RIFT-697 模板在同一场景链路下复核 Empowered 门控的授予与撤销，仍不能证明 Shield 战斗加值或 Deflect 税已执行。" +
    "不近似实现：不伪造启动能力，不把依赖能力写成无条件能力。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
