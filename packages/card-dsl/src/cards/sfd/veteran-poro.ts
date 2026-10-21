import type { CardProgram } from "../../ir/index.js";

/**
 * Veteran Poro — Weaponmaster (CR v1.5 821.1).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-21 against the
 * merged engine sources:
 * - The Weaponmaster expansion, its card-played trigger registration, the
 *   Equipment TargetSpec and the Finalize target lock do execute through the
 *   production lifecycle (real play scenario in the golden test).
 * - The cost half still fails closed. cost.modify's `source` branch measures
 *   `judge-required: 821.1.c.2: missing authoritative Equip-cost binding for
 *   <ref>; original [A]/[C] symbols required`; reduce-equip-cost must not treat
 *   the six-domain allowedDomains set as the printed [A]/[C] symbol source
 *   (821.1.c.3), and an Equipment's play cost is not its Equip cost.
 * - The production chain adapter now decodes cost.modify and Finalize really
 *   locks the selected Equipment. Resolution then stops at the missing cost
 *   binding above, before cost.pay or effect.attach can publish success.
 */
const veteranPoro = {
  canonicalCardId: "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Weaponmaster]（821.1.c.2-.5）仍缺所选 Equipment 的权威 Equip 费用绑定：cost.modify 的 source 分支能找到所选装备，但实测按 821.1.c.2 fail-closed" +
    "（judge-required: missing authoritative Equip-cost binding; original [A]/[C] symbols required），reduce-equip-cost 也按 821.1.c.3 拒绝把六域 allowedDomains 当作原始 [A]/[C] 符号来源；" +
    "不能用装备的打出费用或全价 Equip 近似。生产链路的 Chain adapter 已能解码卡内 constant 信封的 cost.modify 字段；" +
    "productionPlay 实测现已能解锁并解码卡内 cost.modify，且真实 Finalize 已锁定所选 Equipment；随后原语 source 分支仍按 821.1.c.2 抛 judge-required \"missing authoritative Equip-cost binding ... original [A]/[C] symbols required\"，在 cost.pay/effect.attach 成功门控前失败。" +
    "已核实不再缺：Weaponmaster 展开的 card-played 触发经生产 lifecycle 注册、随实际打出事件触发并锁定所选 Equipment（golden 的真实打出场景）。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default veteranPoro;
