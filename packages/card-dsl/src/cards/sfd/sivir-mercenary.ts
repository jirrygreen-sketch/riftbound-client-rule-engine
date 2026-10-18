import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sivir, Mercenary (sfd-143-221) — Unit, Chaos, Sivir/Shurima/Champion.
 * energy 4, power 1, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-143-221，逐字，含换行）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n"
 *   "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词（805.1.b 固定 [1][C]），展开由已合入的
 *   effects/keywords/Accelerate.ts 负责；卡只声明关键词，不重写展开。该印刷 power 为 1（Chaos）。
 * - "If you've spent at least [A][A] this turn"：这是条件静止式能力（363 的 Passive Abilities 条目下
 *   364.3/364.3.a，"if" 引导的条件；383.2.a 类触发条件不适用），需要读取本回合已支付的 Power 总量；[A] 表示任意域
 *   （135.2.e.5.a），不要求支付 Universal Power 资源。
 * - "I have +2 :rb_might:"：算术图层的持续 Might 修改（143.2.a、475–477），不是 Buff 计数器
 *   （702–704 的 Buff 是计数物；effect.buff 文件头明确 +Might 归 continuous.might）。
 * - "and [Ganking]"：条件授予的被动关键词，按契约 3.7 的 continuous.grant-keyword 形状声明，
 *   展开由已合入的 effects/keywords/Ganking.ts 负责（810.1.b 的战场间标准移动许可）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口以 judgeReason 为准；
 * 执行证据在本卡 golden，模板金标为 templates/keyword-static-static-673.test.mjs。
 *
 * 2026-10-18 复核（逐项对照合并源码实测）：
 * - "spent at least [A][A] this turn" 仍无可求值路径（真实缺口）。合并 Expr 的取值面只有
 *   constant/literal/location/object-property/object-attribute/linked(-value)/count/arithmetic 与
 *   RIFT-711 的 player-property/turn-number/player-turn-count/object-designation；powerSpentThisTurn
 *   不是 ObjectSnapshot 特征，evaluateExpression 抛 MissingInformation（实测），生产绑定按 false 兜底。
 *   ResolveContext.history(query) 只返回动作次数且拒绝金额维度（实测传 amount 报
 *   "Unsupported history query field"），count 只数对象。expr-ext 的四个新种类既不含支出金额读取，
 *   也没有生产调用方（src 内无 importer）。不以对象计数或动作次数近似金额。
 * - 条件性 +2 Might：执行侧与注册消费方均已合入（continuous.might +
 *   programs/statics.ts 的 bindStaticToLayers/attachProgramLifecycle），golden 实测经图层求值得到 +2。
 * - 条件性 [Ganking]：授予原语、ability 图层关键词写入、以及 RIFT-710 的关键词二次展开
 *   （programs/keyword-grants.ts 的 expandEffectiveKeywords/KeywordGrantLayerEngine，把已授予关键词
 *   经 KeywordDef 展开成 continuous.movement 并产出 permission.routes）都已合入；实测在
 *   KeywordGrantLayerEngine 下授予 Ganking 后 movement().canGank 为 true，真实 Standard Move 成功。
 *   但没有任何生产装配安装该引擎：ChainEngine 默认用普通 LayerEngine，TurnFlow 用同样非授权的
 *   TurnPhaseLayers，只有 RIFT-710 测试导入 KeywordGrantLayerEngine。生产 Duel 移动入口
 *   beginDuelStandardMoveV2 只收调用方传入的 trustedGanking（cardplay-unit-v2.ts 传 services.ganking），
 *   从不传 DuelMovementRuleContext，所以 zones/movement.ts 既不查图层关键词也不查 ruleView，
 *   movement().canGank 实测在生产同构路径上仍为 false。
 *   此外该引擎对无法求值的条件直接抛出（changes() 未按 programs/statics.ts 那样 fail-closed），
 *   把本卡的条件接进去会抛 MissingInformation（实测）。加上第一项的支出门槛永不成立，
 *   本卡印刷的 [Ganking] 目前不可达。
 * - [Accelerate]：KeywordDef 的费用声明与 805.6 入场替代、cost/cost-plan.ts 的 accelerate
 *   OptionalCostInput、chain/engine.ts resolve() 的 selectedAdditional 消费都已合入，
 *   缺的是卡牌声明→CostPlanInput 的生产接线：programs/play.ts translateCost 对展开的 cost 抛
 *   "Unsupported play cost field optional"，programs/statics.ts layerFor 没有 accelerate.cost 映射
 *   （实测 ProgramBindingError "Static ability kind accelerate.cost has no layer mapping"），
 *   也没有任何 producer 读取 accelerate.cost 静态声明去生成 { kind: "accelerate" } 费用组。
 *   实测偏差：可选 [1][C] 从不收取（场景打出只付印刷 4 Energy、无 pay 事件），
 *   而入场替代仍无条件生效，单位因此未付费就进 ready——805.2.b/805.6 的付费门控缺失。
 * 依赖：本回合 Power 支出金额的读取接口、KeywordGrantLayerEngine 的生产装配（含移动入口的
 *   DuelMovementRuleContext 或等价 trusted 评估器）与条件 fail-closed、
 *   accelerate.cost→CostPlanInput.optionalAdditional 的生产接线。
 * 不近似实现：不以对象计数/动作次数代替支出金额，不把条件性 +2 Might 写成 Buff，
 *   不无条件授予 [Ganking]，也不把可选加速费当作已付。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      // 364.3/364.3.a 的条件静止式能力："I have +2 [M]"（143.2.a / 475–477 的算术图层）。
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 2 }
    },
    condition: {
      kind: "compare",
      // "you've spent at least [A][A] this turn"：写成本回合已支付 Power 金额的读取意向。
      // 没有合并的 Expr/Context 特征承载该金额，生产绑定按 false 兜底（见 judgeReason）。
      left: {
        kind: "object-property",
        object: "source",
        property: "powerSpentThisTurn"
      },
      operator: "gte",
      right: { kind: "constant", value: 2 }
    }
  },
  {
    kind: "static",
    effect: {
      // 810.1.b：条件授予 [Ganking]；授予后的许可产出已合入，但生产引擎未装配（见 judgeReason）。
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: { id: "Ganking" }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "source",
        property: "powerSpentThisTurn"
      },
      operator: "gte",
      right: { kind: "constant", value: 2 }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-18 复核后的当前缺口（均实测，不近似实现）：" +
    "(1)「If you've spent at least [A][A] this turn」无可求值路径：合并 Expr 的取值面（object-property/count/arithmetic " +
    "与 RIFT-711 的 player-property/turn-number/player-turn-count/object-designation）没有本回合已支付 Power 金额，" +
    "powerSpentThisTurn 不是 ObjectSnapshot 特征，evaluateExpression 抛 MissingInformation；ResolveContext.history(query) " +
    "只返回动作次数且拒绝金额维度（传 amount 报 Unsupported history query field），count 只数对象。" +
    "expr-ext 的扩展求值器既不含支出金额种类也没有生产调用方（src 内无 importer）。" +
    "[A] 按 CR 135.2.e.5.a 指任意域 Power，费用管线已有 power + allowedDomains 表示，不是契约缺口。" +
    "(2) 条件性 +2 Might 已可执行：执行侧 continuous.might 与 programs/statics.ts 的 bindStaticToLayers/attachProgramLifecycle " +
    "都已合入，golden 经图层求值实测得到 4 → 6，且 buffs 仍为 0（不写成 Buff）。" +
    "(3) 条件性 [Ganking] 的产出侧已合入但生产未装配：continuous.grant-keyword 原语、ability 图层关键词写入，" +
    "以及 RIFT-710 的 programs/keyword-grants.ts（expandEffectiveKeywords/KeywordGrantLayerEngine）把已授予关键词 " +
    "展开成 continuous.movement 并产出 permission.routes 都已合入，实测授予后 movement().canGank 为 true 且 Standard Move 成功；" +
    "但没有任何生产装配安装该引擎：ChainEngine 默认用普通 LayerEngine、TurnFlow 用同样非授权的 TurnPhaseLayers，" +
    "只有 RIFT-710 测试导入它；生产移动入口 beginDuelStandardMoveV2 也只收调用方传入的 trustedGanking，" +
    "从不传 DuelMovementRuleContext，所以生产同构路径上 canGank 仍为 false。" +
    "该引擎对无法求值的条件还会直接抛出（changes() 未 fail-closed），" +
    "把本卡条件接进去抛 MissingInformation；叠加 (1) 的门槛永不成立，印刷的 [Ganking] 不可达。" +
    "(4) [Accelerate] 的卡牌接线缺失：KeywordDef 的 accelerate.cost 声明与 805.6 入场就绪替代、" +
    "cost/cost-plan.ts 的 accelerate 可选费用组、chain/engine.ts resolve() 的 selectedAdditional 消费都已合入，" +
    "但 programs/play.ts translateCost 对展开的 cost 抛 Unsupported play cost field optional，" +
    "programs/statics.ts layerFor 没有 accelerate.cost 映射（实测 ProgramBindingError Static ability kind " +
    "accelerate.cost has no layer mapping），且没有 producer 从该声明生成 { kind: \"accelerate\" } 费用组；" +
    "场景实测打出只付印刷 4 Energy、无 pay 事件，可选 [1][C] 从不收取，" +
    "而 805.6 入场替代仍无条件生效，单位未付费即 ready（805.2.b 的付费门控缺失）。" +
    "依赖：本回合 Power 支出金额的读取接口、KeywordGrantLayerEngine 的生产装配与条件 fail-closed、" +
    "accelerate.cost → CostPlanInput.optionalAdditional 的生产接线。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
