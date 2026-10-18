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
 * - 2026-10-18 复核：programs/keyword-grants.ts 的 KeywordGrantLayerEngine 已能把授予后的
 *   Deflect/Shield 重新展开为 target.tax / continuous.might（参考层实测），但该层未接入生产
 *   turn/layer 构造，见 judgeReason 第 3 条。
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
    "三处缺口（827.1.c.1、828.1.b.1，2026-10-18 复核），均为实测行为，不近似实现：" +
    "(1) Empower KeywordDef 已注册并支持未 Empowered 限制，但 KeywordAbility / programs/keywords.ts 不传递本卡印刷的 3 Energy CostSpec " +
    "（契约 3.1 的 KeywordAbility 只有 keyword/value），expand 只产出 { kind: \"empower\" }，费用规划实测抛 " +
    "CostPlanError judge-required \"Unsupported cost kind: empower\"，无法建立完整启动费用计划。" +
    "(2) “在参考内核可求值、生产不可求值”的差异收窄为一处：门控 self.empowered >= 1 在参考内核里已能随真实 empower/disempower 动作开关，" +
    "但契约 ObjectSnapshot（engine-core/src/effects/contract.ts）不声明 live empowered 计数，apps/game-server 的引擎宿主把 " +
    "empower 动作写成 buffs，缺字段时求值抛 MissingInformation \"Unavailable characteristic: empowered\"，失败闭合。" +
    "(3) 持续授予关键词只有参考层的重展开、没有生产消费方：已合入的 programs/keyword-grants.ts KeywordGrantLayerEngine " +
    "能把 empower 后的 Deflect 1 / Shield 3 重新展开（实测可读到 target.tax 与 continuous.might，Shield 使防守者 Might 3→6，" +
    "809.1.c.1 的任意域 Power 税经 createTargetTaxAdapter 可计价），但该层只被 engine-core 自身测试构造，" +
    "既没有从任何公开入口导出，也没有被 turn/flow.ts、apps/game-server 使用（两处仍构造 TurnPhaseLayers）；" +
    "生产 programs/statics.ts 的 bindStatic 仍不映射 Deflect 展开出的 target.tax（实测 ProgramBindingError judge-required），" +
    "Chain Finalize 也仍未构造 createTargetTaxAdapter，Deflect 税从未进入生产目标 Finalize；" +
    "关键词展开读取的 designation 在生产条件的默认求值器上仍不可读（实测 \"Unavailable characteristic: designation\"），" +
    "且 combat/flow.ts 的 combat-start-transaction 仍抛 TurnCombatBlockedError，没有生产写入方发布 ObjectSnapshot.combatRole。" +
    "模板 golden 只验证门控开/关时的关键词授予与撤销，不能证明 Shield 战斗加值或 Deflect 税已执行。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
