import type { CardProgram } from "../../ir/index.js";

/**
 * Combat Chef (sfd-092-221) — Unit, 5 Energy, 力量未印刷，Might 5，
 * Body，标签 Demacia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-092-221，逐字）:
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
 * status = judge-required（cards/README.md 第 2 节）：展开文件与 programs/ 绑定已合入，但
 * - 费用路径在解释器侧即被拒：effects/instructions/cost.modify.ts 对 Weaponmaster 来源
 *   形态抛 judge-required（821.1.c.3 的 [A] 减费），另一分支对不含 [A] 的目标 Equip 费
 *   抛 judge-required（821.1.c.2 的「如同激活」计算）；
 * - cost/plan-values.ts 的 readCost 对 Equip 支付种类（payments kind "equip"）判 blocked；
 * - programs/keywords.ts 的 expandProgram 只把 { value, host } 传给 KeywordDef.expand，
 *   契约 3.8.3 的 params.cost 没有路径。
 * 不近似实现。
 */
const combatChef = {
  canonicalCardId:
    "card.hash-11a243735e7d6ec7f8c088e08005d1726940f651be3103a3e9e71b92757b3410",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Weaponmaster expansion and the programs/ binding are merged, but the cost " +
    "path is judge-required end to end: effects/instructions/cost.modify.ts throws " +
    "judgeRequired for the Weaponmaster source shape (821.1.c.3, the [A] reduction) " +
    "and for a target Equip cost containing no [A] (821.1.c.2, the as-if activation " +
    "calculation), so the Equip cost cannot be calculated or paid before effect.attach " +
    "runs. cost/plan-values.ts readCost also blocks the expansion's Equip payment kind " +
    "\"equip\" (\"Unsupported payment kind: equip\"). programs/keywords.ts " +
    "expandProgram passes only { value, host } to KeywordDef.expand, so the printed " +
    "cost composition has no params.cost path (contract 3.8.3). " +
    "The merged effect.attach step is exercised by the golden test; not approximated.",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default combatChef;
