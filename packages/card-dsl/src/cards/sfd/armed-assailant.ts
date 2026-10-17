import type { CardProgram } from "../../ir/index.js";

/**
 * Armed Assailant (sfd-002-221).
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-002-221，逐字）:
 *   [Accelerate] / [Weaponmaster] 两条印刷关键词。
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词；805.1.b 费用固定 1 energy + 1 power
 *   （本卡为 Fury 域 [F]，805.1.b.1 要求 power 域与单位域匹配）；805.6/805.6.a 是
 *   付费后的入场就绪替代。卡内只声明 { kind: "keyword", keyword: "accelerate" }
 *   （契约 3.7/README 第 5 节），展开由已合入的 effects/keywords/Accelerate.ts 负责。
 * - [Weaponmaster]（821）：打出本单位时可以 [Equip] 一件自己的装备，且 [Equip]
 *   费用减 1 个任意 power（821.1.c.3），即使已附带也可重挂（821.1.c.2.a/.2.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，当前真实缺口：
 * - [Weaponmaster] 的展开 effects/keywords/Weaponmaster.ts 已合入，生产链的目标查询
 *   可绑定 controller:self；剩余费用缺口是 cost.modify 对 reduce-equip-cost 显式判负
 *   （821.1.c.3 的 [A]/[C] symbol provenance 会丢失），阻断后续 cost.pay 与 Attach。
 * - [Accelerate] 的关键词展开与 accelerate 费用计划已合入，但打出流程 Finalize 的
 *   optionalAdditional 收取与 805.6 入场就绪替代条件管线仍无消费方。
 * 依赖：Weaponmaster 的 reduce-equip-cost 费用支持、
 * Finalize Accelerate 接线。不近似实现（不把手写 Equip 收费塞进卡程序）。
 */
export default {
  canonicalCardId: "card.hash-8518a281524e1e72c165821192f2957a4ce78725737d98dbb03e70569739aec0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Accelerate]（805）的关键词展开与 accelerate 费用计划已合入，但把费用接进打出流程 Finalize 的 optionalAdditional 收取与 805.6 入场就绪替代条件管线仍无消费方；" +
    "[Weaponmaster]（821）的展开 effects/keywords/Weaponmaster.ts 与生产链的 controller:self 目标绑定已合入；剩余缺口是 cost.modify 对 reduce-equip-cost 显式判负（821.1.c.3 的 [A]/[C] symbol provenance 会丢失），阻断后续 cost.pay 与 Attach。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "weaponmaster" }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;
