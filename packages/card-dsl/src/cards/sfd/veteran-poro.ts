import type { CardProgram } from "../../ir/index.js";

/**
 * Veteran Poro — Weaponmaster (CR v1.5 821.1).
 * Keyword expansion and ordinary cost primitives exist. Authoritative Equip costs,
 * original Power symbols and the self-play event binding still block execution.
 */
const veteranPoro = {
  canonicalCardId: "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Weaponmaster]（821.1.c.2-.5）仍缺所选 Equipment 的权威 Equip 费用绑定及原始 [A]/[C] 符号来源：cost.modify 的 source 分支能找到所选装备，但 reduce-equip-cost 会按 821.1.c.3 fail-closed，不能用装备的打出费用代替 Equip 费用；该折扣必须仅减原始 [A]。费用计划到 Finalize 的消费和成功支付后的附着仍需接线。另需将关键词展开的 card-played source 过滤绑定到当前宿主对象；实际打出事件使用 object。不以普通 Power 折扣或全价 Equip 近似。",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default veteranPoro;
