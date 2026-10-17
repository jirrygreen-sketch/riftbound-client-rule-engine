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
 * status = judge-required。自本程序初写后合入的依赖：Assault 的 KeywordDef（RIFT-264～268）、
 * continuous.might 指令（RIFT-258）、CardProgram 绑定（RIFT-257）。
 *
 * 仍缺四处（不近似实现）：
 * - Accelerate 的 accelerate.cost 静态效果没有 Finalize/费用计划消费方，入场就绪也没有
 *   replacement.enter 接线（chain/engine.ts 只读调用方传入的费用计划；programs/play.ts 对
 *   additional-cost 类字段直接判 judge-required 失败）；
 * - Assault 2 需要 807.1.d 的 Attacker designation 与求值后的图层修正：ObjectSnapshot.combatRole
 *   已进入 HEAD（契约 3.8），但战斗角色 designation 没有产生方（combat/flow.ts 仍抛
 *   combat-start-transaction），layers/engine.ts 的 conditionMatches 也不求值该 compare 条件（按 true 处理）；
 * - Deflect 的 target.tax 接线：target/target-plan.ts 已有 Deflect 税的部分支持（TargetFinalizeOptions.tax
 *   与 taxAdapter），但 layers/rules/query.ts 没有 target.tax 查询、关键词展开也没有接线进 Finalize；
 * - Ganking 的 continuous.movement 许可需要移动系统读取（movement() 查询已合入但没有调用方）。
 * 任一未接线即不能宣称整卡可执行；golden 只做身份、结构与已合入展开文件的形状校验，缺依赖写 test.todo。
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
    "Assault 的 KeywordDef（RIFT-264～268）、continuous.might（RIFT-258）与卡牌程序绑定（RIFT-257）已合入，" +
    "但仍缺四处管线接线，缺一即不能宣称整卡可执行，均不近似实现：" +
    "(1) Accelerate 的 accelerate.cost 静态效果没有 Finalize/费用计划消费方，805.2.b/805.6 的入场就绪也没有 replacement.enter 接线" +
    "（chain/engine.ts 只读调用方传入的费用计划；programs/play.ts 对 additional-cost 类字段直接判 judge-required 失败）。" +
    "(2) Assault 2（807.1.c）需要 807.1.d 的 Attacker designation 与求值后的 continuous.might 图层：ObjectSnapshot.combatRole 已进入 HEAD（契约 3.8），" +
    "但战斗角色 designation 没有产生方（combat/flow.ts 仍抛 combat-start-transaction），layers/engine.ts 的 conditionMatches 也不求值该 compare 条件（按 true 处理）。" +
    "(3) [Deflect]（809.1.b.3 省略数值时按 1）的 target.tax 接线：target/target-plan.ts 已有 Deflect 税的部分支持" +
    "（TargetFinalizeOptions.tax 与 taxAdapter），但 layers/rules/query.ts 没有 target.tax 查询，关键词展开也没有接线进 Finalize。" +
    "(4) Ganking 的 continuous.movement 许可需要移动系统读取（movement() 查询已合入但没有调用方）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
