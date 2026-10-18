import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * baccai-sandspinner — M2 源码复核（2026-10-18）。
 * CR v1.5 827.1.c.1：Empower 印刷费用为 5 Energy；827.1.c.3 的控制 4 或更少符文时减 3 Energy。
 * 442.1.a/828.1.b.1：依赖能力只在宿主 Empowered 时有效。
 *
 * status = judge-required（四处当前缺口，均为实测，不近似实现）：
 * 1. 印刷费用没有载体：KeywordAbility 只有 keyword/value（本卡另有 value: 5），
 *    expandProgram 调到 Empower.expand 时拿不到 params.cost，实测产出 { kind: "empower" }；
 *    生产 buildCostPlan 对该 kind 抛 CostPlanError('Unsupported cost kind: empower')。
 * 2. 827.1.c.3 的减费没有消费方：实测 computeEngineStaticBinder.bindStatic 对
 *    appliesTo: "empower-activation-cost" 抛 ProgramBindingError('Unsupported static appliesTo')，
 *    连注册都到不了费用计划、进不了 Chain Finalize；且条件里的 count(filter { controller:self })
 *    在生产图层匹配器上不是相对该能力控制者求值：layers/filter.ts 的 selectorMatches 拿
 *    "对象自己的 controller"当比较基准，因此 controller:self 退化成"任意控制者"
 *    （实测对手的符文同样命中），只有绝对玩家 id 才能限定集合、无法跟随控制者变化。
 * 3. Empowered 门控：本卡用 object-property(self, "empowered")，实测参考内核路径可求值
 *    （Empower 后 keywords 里出现 deflect 1 与 assault 2），但 ObjectSnapshot 契约没有
 *    empowered 字段、engine-runtime/host.ts 也不提供。
 * 4. KeywordGrantLayerEngine 已能在独立 adapter 中重展开 granted Assault 2 / Deflect 1，
 *    并按 combatRole/designation 计算攻击者 Might；默认 CardProgram lifecycle 仍使用基础
 *    LayerEngine，所以生产图层只登记关键词，不消费 Assault 修正。Deflect 展开的
 *    { kind: "target.tax" } 仍在 bindStatic 抛 'no layer mapping'，Chain Finalize 也没有
 *    Power 目标税消费方。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 5
  },
  {
    // 827.1.c.3 / 206.1：这条文本改写的正是该 Empower 起动费用，不是独立效果。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      amount: { kind: "constant", value: -3 },
      // 356.6：Energy 费用不能被减到 0 以下；具体钳制由费用计划执行。
      minimum: 0
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      },
      operator: "lte",
      right: { kind: "constant", value: 4 }
    }
  },
  {
    // 828.1.b.1 / 828.1.c：宿主拥有 Empowered 状态时获得 [Deflect] 与 [Assault 2]。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "assault", value: 2 }
      ]
    },
    // 828.1.c：依赖能力读取来源实时 empowered 计数。
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-43ef38def4a837781a4013a179db99f1eb1e312f85de8d9c3053f7168a1652f5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（2026-10-18 复核，均为实测）：(1) 827.1.c.1 的 5 Energy 印刷费用没有载体——" +
    "KeywordAbility 只有 keyword/value（本卡值 5），expandProgram 调到 Empower.expand 时拿不到 params.cost，实测产出 { kind: \"empower\" }，" +
    "生产 buildCostPlan 抛 CostPlanError('Unsupported cost kind: empower')。" +
    "(2) 827.1.c.3 的减 3 Energy（continuous.cost-modification）没有消费方：实测 bindStatic 对 appliesTo: \"empower-activation-cost\" 抛 " +
    "ProgramBindingError('Unsupported static appliesTo')，注册阶段就失败，因此该减费进不了 Chain Finalize；条件里的 count(filter { controller:self }) 也没有相对值——" +
    "layers/filter.ts 的 selectorMatches 以对象自身 controller 为基准，写 controller:self 会退化成任意控制者（实测对手的符文同样命中），" +
    "只能写绝对玩家 id，无法跟随控制者，因此不能用测试内符号替换冒充生产已实现。" +
    "(3) 442.1.a/828.1.b.1 的 Empowered 门控：卡牌用 object-property(self, \"empowered\")，实测参考内核路径可求值（Empower 后 keywords 出现 deflect 1 与 assault 2），" +
    "但 ObjectSnapshot 契约没有 empowered 字段、engine-runtime/host.ts 也不提供。" +
    "(4) continuous.grant-keyword 本身已合入；独立 KeywordGrantLayerEngine adapter 可把 granted Assault 2 / Deflect 1 " +
    "重展开，并按 combatRole/designation 计算攻击者 Might，但默认 CardProgram lifecycle 仍使用基础 LayerEngine，" +
    "生产图层只登记关键词而不消费该修正。809.1.c 的 Deflect Power 目标税仍没有生产适配器——Deflect 展开的 " +
    "target.tax 在 bindStatic 抛 \"no layer mapping\"，Chain Finalize 没有 Power tax 消费方。不近似实现。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_5:. This ability costs :rb_energy_3: less if you control 4 or fewer runes. " +
    "(Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Assault 2]. (Opponents must pay :rb_rune_rainbow: to choose me " +
    "with a spell or ability. +2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;
