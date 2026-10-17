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
 * - "If you've spent at least [A][A] this turn"：这是静态能力的条件（363 的 Passive Ability 带条件，
 *   383.2.a 类触发条件不适用），需要读取"本回合已支付的 [A]（163.2.b Universal Power）总量"。
 * - "I have +2 :rb_might:"：算术图层的持续 Might 修改（143.2.a、475–477），不是 Buff 计数器
 *   （702–704 的 Buff 是计数物；effect.buff 文件头明确 +Might 归 continuous.might）。
 * - "and [Ganking]"：条件授予的被动关键词，按契约 3.7 的 continuous.grant-keyword 形状声明，
 *   展开由已合入的 effects/keywords/Ganking.ts 负责（810.1.b 的战场间标准移动许可）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口已收窄。
 * - "spent at least [A][A] this turn" 仍无可求值路径：合并 IR 的 Expr/Condition 只能读对象特征、
 *   链接值与对象计数（count 只数对象、不读金额），契约 3.6 的 ResolveContext 没有 spent / 费用回执读数
 *   （同 unl/virtuoso 记录的缺口）；"[A]" 本身是 163.2.b 的 Universal Power，封闭 Domain 类型与
 *   payment 记录也不表达（effect.resources 明确保持 unsupported）。此外该条件必须**先有**求值器：
 *   layers/engine.ts 的 conditionMatches 只认 always/never/type/has-tag/has-keyword，未知 kind 按 true，
 *   把上面的 compare 直接注册进图层会恒真开闸（golden 实测），所以卡内不得把它当已实现。
 * - 条件性 +2 Might 的执行侧已合入：continuous.might（RIFT-258）能注册算术层修改，golden 用该原语
 *   注册后经图层求值得到 +2；卡牌 static 的注册消费方也已合入（RIFT-257 的 bindStaticToLayers +
 *   attachProgramLifecycle，programs/statics.ts），条件经 evaluateCondition 包装成运行时函数求值。
 * - 条件性 [Ganking] 授予：continuous.grant-keyword（RIFT-258）与 ability 图层（applyAbility 写 keywords）
 *   都已合入；static 注册消费方同样已合入（同上），卡牌 static 现在可以落到图层。
 * - [Accelerate] 的展开与费用计划消费方都已合入：Finalize 的 optionalAdditional 接线
 *   （cost/cost-plan.ts 的 selectedAdditional + chain/engine.ts 的加速进场判定）。
 * 依赖：Universal Power 的契约变更请求 + layers 条件求值器（compare 语义）。
 * 不近似实现：不把 2 个 [A] 写成"任意 2 点力量"，不把条件性 +2 Might 写成 Buff，也不无条件授予 [Ganking]。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      // 383.2.b 类条件持续效果："I have +2 [M]"（143.2.a / 475–477 的算术图层）。
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 2 }
    },
    condition: {
      kind: "compare",
      // "you've spent at least [A][A] this turn"：合并 IR 没有读取本回合已支付 [A] 的表达式
      // （count 只数对象、不读金额，ResolveContext 也没有 spent 读数），这是保留的形状。
      left: {
        kind: "count",
        subject: "universal-power-spent-this-turn",
        filter: { player: "controller" }
      },
      operator: "gte",
      right: { kind: "constant", value: 2 }
    }
  },
  {
    kind: "static",
    effect: {
      // 810.1.b：条件授予 [Ganking]，由 continuous.grant-keyword 的授予路径负责（未合入）。
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: { id: "Ganking" },
      duration: "this-turn"
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "universal-power-spent-this-turn",
        filter: { player: "controller" }
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
    "缺口已收窄但仍不可执行，不近似实现：(1)「If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn」无可求值路径——合并 IR 的 Expr/Condition " +
    "只能读对象特征、链接值与对象计数（count 只数对象、不读金额），契约 3.6 的 ResolveContext 没有 spent / finalized 费用回执读数（同 unl/virtuoso 的缺口）；" +
    "「:rb_rune_rainbow:」本身是 163.2.b 的 Universal Power，封闭 Domain 类型与 payment 记录不表达（effect.resources 明确 unsupported、不用具名域近似）。" +
    "该条件还缺求值器：layers/engine.ts 的 conditionMatches 只认 always/never/type/has-tag/has-keyword，未知 kind 按 true，把上述 compare 直接注册进图层会恒真开闸，" +
    "golden 实测该恒真行为。(2) 条件性 +2 Might 的执行侧已合入（continuous.might，RIFT-258）：golden 用该原语注册后经图层求值得到 +2；" +
    "卡牌 static → 图层的注册消费方也已合入（RIFT-257 的 bindStaticToLayers + attachProgramLifecycle，programs/statics.ts，" +
    "条件经 evaluateCondition 包装成运行时函数求值）。(3) 条件性 [Ganking] 同理已可落到图层：" +
    "continuous.grant-keyword（RIFT-258）与 layers 的 ability 层关键词写入（applyAbility）都已合入，static 注册消费方同上已合入；" +
    "移动系统读取的是图层 movement 特征（同 ogn/block、sfd/gem-jammer 记录）。(4) [Accelerate] 展开与其费用计划消费方都已合入" +
    "（Finalize 的 optionalAdditional 接线，cost/cost-plan.ts 的 selectedAdditional + chain/engine.ts 的加速进场判定）。" +
    "依赖：Universal Power 的契约变更请求 + layers 条件求值器（compare 语义）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
