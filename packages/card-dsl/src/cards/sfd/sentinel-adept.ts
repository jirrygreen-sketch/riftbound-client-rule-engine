import type { CardProgram } from "../../ir/index.js";

/**
 * Sentinel Adept (sfd-008-221) — Unit, 3 Energy, 力量未印刷，Might 3，
 * Fury，标签 Shadow Isles/Sentinel。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-008-221，逐字）:
 *   "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)"
 *
 * 规则依据（CR v1.5）:
 * - 821.1.a：Weaponmaster 印在单位上；821.1.b 把它定义为可选地选择一件你控制的
 *   Equipment、按其 Equip 费（减 [A]）支付后附着到本单位的 Play Effect；
 * - 821.1.c 的功能文本（打出触发 + may + 支付 Equip 费 + attach，即使已附着）；
 * - 821.1.c.1：选择对象不要求该 Equipment 有 Equip 能力；821.1.c.2 费用按
 *   “如同以本单位为对象激活该 Equip 能力”计算；821.1.c.3：Equip 费不含 [A]
 *   仍可支付但不减费；821.1.c.7：多个 Weaponmaster 分别触发。
 *
 * 卡牌只声明 { kind: "keyword", keyword: "weaponmaster" }（契约 3.1/3.7、README
 * 第 5 节）；展开由 engine-core 的 effects/keywords/Weaponmaster.ts 负责，
 * 卡内不重写关键词逻辑。
 *
 * status = judge-required（cards/README.md 第 2 节）。已合入的部分：Weaponmaster
 * KeywordDef 与 CardProgram 绑定都已就绪——registerProgramTriggers 能把展开出的
 * card-played 触发注册成 TriggerRegistration，chain/engine.ts 现在也在成功结算的
 * card-played 事件上携带 source，展开体最后一步的 effect.attach 也能真实附着（golden 执行）。
 * 展开体使用的 cost.modify / cost.pay 原语都已注册，
 * 但 cost.modify 的 Weaponmaster 分支显式抛 judge-required：821.1.c.2 缺少把所选
 * Equipment 的 Equip 费绑定进 CostPlan 的权威来源（ObjectSnapshot 只暴露 play 费用），
 * 821.1.c.3 的 [A]/[C] 印刷来源也无法区分，所以触发进入链后必然在 cost.modify 上失败。
 * 不近似实现。
 */
const sentinelAdept = {
  canonicalCardId:
    "card.hash-b5a71d562e350fc2da5172cbd7a0ef37531661ac9a27651a3cdfc1784f22b918",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster KeywordDef and CardProgram binding are merged: registerProgramTriggers registers " +
    "the expansion's card-played trigger, chain/engine.ts includes source on the successful card-played event, " +
    "and the final effect.attach step attaches the chosen Equipment for real (golden). The card is still " +
    "judge-required because the expansion body pays the chosen Equipment's Equip cost through cost.modify / " +
    "cost.pay, and both opcodes are registered, but the cost.modify Weaponmaster branch raises judge-required " +
    "itself: 821.1.c.2 has no authoritative binding of the chosen Equipment's Equip cost into the CostPlan " +
    "(ObjectSnapshot exposes only play costs), and 821.1.c.3 cannot distinguish an original [A] symbol from " +
    "a [C] identity with the same domains. The trigger therefore reaches the cost step and fails closed before " +
    "payment; not approximated.",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default sentinelAdept;
