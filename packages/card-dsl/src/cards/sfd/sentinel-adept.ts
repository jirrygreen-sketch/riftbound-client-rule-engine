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
 * status = judge-required（cards/README.md 第 2 节）：展开文件虽已合入，但其 body
 * 使用的 cost.modify / cost.pay 在 effects/instructions/registry.generated.ts 没有
 * 注册的 InstructionDef，也没有生产方把卡牌上的 keyword 能力接进打出流程，
 * 821.1.c.2 的 Equip 费计算与 821.1.c.3 的 [A] 减费无法执行。缺 RIFT-89
 * （费用计划/支付）与关键词展开接线；不近似实现。
 */
const sentinelAdept = {
  canonicalCardId:
    "card.hash-b5a71d562e350fc2da5172cbd7a0ef37531661ac9a27651a3cdfc1784f22b918",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster expansion file (effects/keywords/Weaponmaster.ts) is merged, " +
    "but the card is not executable end to end: the expansion body pays the chosen " +
    "Equipment's Equip cost through cost.modify / cost.pay, and neither opcode has a " +
    "registered InstructionDef in effects/instructions/registry.generated.ts, nor does " +
    "any producer expand a card's keyword ability into the play pipeline. 821.1.c.2 " +
    "(cost determined as though the Equip ability were activated targeting this unit) " +
    "and 821.1.c.3 (the [A] reduction) therefore cannot be calculated or paid before " +
    "effect.attach runs. Depends on RIFT-89 (cost planning/payment primitives) and the " +
    "keyword-expansion wiring; not approximated.",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default sentinelAdept;
