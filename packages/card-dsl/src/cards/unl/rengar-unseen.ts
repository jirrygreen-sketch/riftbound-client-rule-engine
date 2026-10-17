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
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
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
    "缺 Accelerate 的 accelerate.cost 到 Finalize 可选附加费用及付费后才生效的入场替代绑定（805.1.b/805.2.b/805.6）；费用计划支持 accelerate 组件但 CardProgram 未提供该组件。" +
    "缺 Assault 的 designation 到 ObjectSnapshot.combatRole 映射（807.1.c/807.1.d）：静态 compare 条件已可求值，关键词却读取不存在的 designation；combat-start-transaction 仍未产生战斗角色。" +
    "缺 Deflect 的 target.tax 静态绑定及 target/tax 适配器到 Chain Finalize 的接线（809.1.c.1）；target-plan 已有目标税接口，但链仍按 Energy 而非任意域 Power 收费。" +
    "缺 Ganking 的 continuous.movement 许可翻译与标准移动消费方（810.1.b/144.4.c.1），movement() 读取 permission.routes，关键词仍给 permission 字符串。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)\n" +
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default program;
