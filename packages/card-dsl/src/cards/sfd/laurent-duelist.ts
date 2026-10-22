import type { CardProgram } from "../../ir/index.js";

/**
 * Laurent Duelist (sfd-156-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-156-221):
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)
 *
 * [Assault 2] is a declared keyword, not a card-local effect. The engine
 * Assault KeywordDef expands it into a continuous arithmetic +2 Might effect,
 * conditioned on the exact Unit's Attacker designation (CR 807.1.c/.d.1).
 * CombatFlow establishes and removes that designation at CR 466.2.c.3 and
 * 468.7.a; the ChainEngine's read-only combat-role projection makes the live
 * static condition and layer path observe the same designation without
 * mutating the authoritative host snapshot. ProgramBinding installs the
 * expansion automatically when Laurent enters the Board.
 *
 * The Play/lifecycle, designation and layer path are executable, but the full
 * damage path is not yet correct. CombatFlow returns an already-layered Might 5
 * Unit, then transactions/damage.ts feeds that snapshot back into the same
 * LayerEngine for currentMight evaluation. Assault applies a second time and
 * the damage plan reports 7 where CR 467.2 requires 5. Keep the card fail-closed.
 */
const laurentDuelist = {
  canonicalCardId: "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡仍为 judge-required（2026-10-22 复核）：独立探针临时放行状态后，从手牌 Play 可完成 4 Energy 支付并自动安装 Assault 2，" +
    "真实 CombatFlow 的 466.2.c.3 角色投影也使攻击者层快照为 5、防守者和非战斗为 3；但完整 Play/战斗路径进入 " +
    "packages/engine-core/src/combat/transactions/damage.ts:166 的 currentMight 后，CombatFlow.units() 已层化的" +
    "ObjectSnapshot（Might 5）被原样 setObjects 回同一 LayerEngine，第 167 行 evaluate 再次应用 Assault，" +
    "prepareDamage()/damageView().attackerMight 实测为 7，而 CR 467.2 要求 current Might 5，违反 CR 478.2/478.4" +
    "的一次应用语义。建议 engine-core owner 在 damage.ts 的 currentMight 与 106/167 行 Stunned lethal 读取处从 " +
    "未层化 raw/host 输入重建层对象，或让 LayerEngine 从 printed 基线重算；不得在已层化结果上重放。正式 ProgramBinding 继续 fail-closed。",
  abilities: [{ kind: "keyword", keyword: "assault", value: 2 }],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default laurentDuelist;
