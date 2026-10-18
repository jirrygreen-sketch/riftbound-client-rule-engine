import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rengar, Unseen (unl-024-219) — Unit, 4 energy, 1 power (Fury), Might 4,
 * Fury, tags Cat/Rengar/Ixtal/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-024-219，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost
 *   to have me enter ready.)
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1 / 805.1.a / 805.1.b）：单位上的可选附加费用关键词，费用固定 1 energy + 1 power，
 *   805.1.b.1 要求 Power 与单位某一域匹配（本卡是 Fury）；805.4 多个实例冗余（stacking single）；
 *   805.2.b/805.6 付费后产生延迟替代，使单位以就绪状态进场且不触发“成为就绪”类能力。
 * - [Assault 2]（807.1.b.1/807.1.b.2/807.1.c）：带印刷值 2 的被动关键词，功能上是“当我是攻击者时 +2 [M]”；
 *   807.2 多个来源的 Assault 值相加（stacking sum）。
 * - [Deflect]（809.1.b.3）：省略数值时 Deflect Value 为 1（本卡印刷 [Deflect] 无数字）；
 *   809.1.c 让对手选择我时多付 [A]。
 * - [Ganking]（810.1.b / 144.4.c.1）：为单位的标准移动增加“战场→战场”许可。
 * 四条都是"只声明关键词"（契约 3.1 / 3.7、README 第 5 节），展开与消费归 effects/keywords/ 与 layers。
 *
 * 2026-10-18 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 四条关键词的展开都能校验通过，静态展开也都能被生产 binder 接受（Assault/Ganking 能注册图层，
 * Accelerate 的费用声明与入场替代能绑定），但没有任何生产消费方把关键字接进打出费用、
 * 战斗角色条件求值、目标税收取或移动许可读取。展开可绑定 ≠ 整卡可执行。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "assault", value: 2 },
  // 809.1.b.3：印刷的 [Deflect] 省略数值，Deflect Value 按 1 处理（省略 value）。
  { kind: "keyword", keyword: "deflect" },
  { kind: "keyword", keyword: "ganking" }
];

const program = {
  canonicalCardId:
    "card.hash-aefc9e1b1b204e123d076f130b2b9b284f4a1f64a08fa9127a1a92c95ff3f6d9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四条关键词的展开都能通过 validateCardProgram，但都还没有可执行的生产消费路径，均不近似实现：" +
    "(1) [Accelerate]（805.1.b/805.2.b/805.6）：费用计划（cost/cost-plan.ts 的 optionalAdditional kind \"accelerate\"）与链的就绪入场消费（chain/engine.ts 读取 selectedAdditional 的 accelerate）都已合入，" +
    "展开的 accelerate.cost 静态声明与入场替代也能绑定（实测 expandProgram(inspect) + createEngineStaticBinder.bindReplacement 成功）；" +
    "缺的是把卡牌 keyword 生产接线到 CostPlanInput：programs/play.ts 的 translateCost 对展开的 cost 仍抛 \"Unsupported play cost field optional\"，" +
    "accelerate.cost 静态声明在 programs/statics.ts 仍抛 \"Static ability kind accelerate.cost has no layer mapping\"，没有任何 play producer 读取它生成 { kind: \"accelerate\" } 费用组。" +
    "(2) [Assault 2]（807.1.c/807.1.d.1）：展开静态能力现在能通过生产 binder 绑定（实测 bindStatic 成功、图层层 kind continuous.might），" +
    "但 programs/statics.ts 的 abilityEnvironment 用基础解释器求值 ability.condition，读到 object-property(self, \"designation\") 时抛 MissingInformation 并按 false 兜底，" +
    "所以 +2 对任何角色都不生效（实测 attacker/defender/null 三种 combatRole 下 Might 均不变）；" +
    "把 designation 映射到 combatRole 的扩展求值器（effects/interpreter/expr-ext/）没有任何生产调用方（grep 全 src 无 importer），" +
    "且 combat/flow.ts 的 startCombat 仍抛 \"combat-start-transaction\"，没有真正的 Attacker designation 生产方。" +
    "(3) [Deflect]（809.1.c/809.1.c.1）：target/tax 的 collectTargetTaxes 与 TargetTaxCostAdapter 已合入，但没有 Chain Finalize 消费方（grep 全 src 无调用），" +
    "而 chain/engine.ts 的税回调把 tax.amount 直接当成 Energy 记入 mandatoryAdditional，无法表达 809.1.c.1 的任意域 Power；" +
    "静态声明在 programs/statics.ts 也仍抛 \"Static ability kind target.tax has no layer mapping\"。" +
    "(4) [Ganking]（810.1.b/144.4.c.1）：展开的 continuous.movement 能通过 binder 绑定并注册到 ability 层，" +
    "但 layers/rules/query.ts 的 movement() 只读 effect.permission.routes，而展开给的是字符串 permission: \"battlefield-to-battlefield\"，" +
    "实测 canGank 仍为 false（改成 { routes: [...] } 拼写才会 true）；标准移动本身也仍抛 \"standard-move-transaction\"。" +
    "依赖：keyword→CostPlanInput 生产接线、static 条件的 designation 扩展求值接线与战斗角色指派、target/tax 的 Chain Finalize 消费、continuous.movement 许可拼写统一。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
