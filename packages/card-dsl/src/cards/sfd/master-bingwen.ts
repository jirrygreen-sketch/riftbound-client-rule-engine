import type { CardProgram } from "../../ir/index.js";

/**
 * Master Bingwen (sfd-127-221) — Unit, 6 Energy, 力量未印刷，Might 6，
 * Chaos，标签 Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-127-221，逐字）:
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
 * status = judge-required（cards/README.md 第 2 节）：Weaponmaster 展开、keyword
 * registry 与 cost.modify / cost.pay 原语均已合入（RIFT-261），但 cost.modify 的
 * reduce-equip-cost 分支在以 judge-required 失败关闭——它需要“原始 [A]/[C] 符号”
 * 绑定才能按 821.1.c.2 计算 Equip 费并按 821.1.c.3 减 [A]，当前 CostPlan 无法区分，
 * 因此 821.1.c.2/.c.3 仍无法执行；不近似实现。
 */
const masterBingwen = {
  canonicalCardId:
    "card.hash-7a011777b95befa4fad1e25df22ffc8e9707030c4927ee2c5297fb8128a01ef4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster KeywordDef, keyword expansion, and the RIFT-261 cost.modify/cost.pay " +
    "primitives are merged, but cost.modify fails closed with judge-required for " +
    "reduce-equip-cost: the cost plan cannot distinguish the original [A] symbol from [C], so " +
    "821.1.c.2 (cost determined as though the Equip ability were activated) and 821.1.c.3 (the " +
    "[A] reduction) still cannot be calculated before effect.attach runs; not approximated.",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default masterBingwen;
