import type { CardProgram } from "../../ir/index.js";

/**
 * Laurent Duelist (sfd-156-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-156-221):
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)
 *
 * [Assault 2] 按契约 3.1 表示为带数值的 keyword 能力（807：攻击时 +2 [M]）。
 * 关键词展开（continuous.might 静态效果 + “我是攻击者”条件）由
 * effects/keywords/Assault.ts 负责，已合入并经 RIFT-257 的 expandProgram 解析
 * （golden 验证展开形状）。
 *
 * 仍缺（实测复核 2026-10-17）：展开里的条件读 ObjectSnapshot 的 designation 特征
 * （compare(object-property(self, "designation") eq "attacker")），但该特征没有
 * 任何生产方写入——combat/flow.ts 的战斗角色事务尚未实现（明确抛
 * combat-start-transaction，combatRole 字段在契约里但无人赋值）；并且默认表达式
 * 求值路径只读快照自有字段（effects/interpreter/expr.ts），实测对 designation 抛
 * Unavailable characteristic，programs/statics.ts 的条件闭包捕获后返回 false
 * （layers/engine.ts 自带的 conditionMatches 也不消费 compare）。实测：即便
 * world().unit(..., { combatRole: "attacker" }) 且经生产 binder 绑定该 static，
 * Might 仍为印刷值 4；因此 +2 Might 在「我是攻击者」期间无法生效。
 * 依赖：战斗角色 designation 的赋值（战斗事务）与默认求值/图层对
 * designation（expr-ext 求值器）的接线。
 */
const laurentDuelist = {
  canonicalCardId: "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "实测（2026-10-17）Assault 的 KeywordDef（effects/keywords/Assault.ts，807.1.c）已合入并解析为 " +
    "continuous.might 静态效果 + 「我是攻击者」条件（golden 验证展开形状），但条件读取的 designation 特征没有生产方：" +
    "combat/flow.ts 的战斗角色事务尚未实现（明确抛 combat-start-transaction；ObjectSnapshot.combatRole 字段存在但无人写入），" +
    "且默认表达式求值路径（effects/interpreter/expr.ts）只读快照自有字段，实测对 designation 抛 Unavailable characteristic，" +
    "programs/statics.ts 的条件闭包捕获后返回 false（layers/engine.ts 的 conditionMatches 也不消费 compare）；" +
    "实测经生产 binder 绑定该 static 后，combatRole 为 attacker 时 Might 仍为印刷值 4。" +
    "故 +2 Might 在攻击期间不生效。依赖：战斗 designation 的赋值（战斗事务）与 designation 的默认求值/图层接线。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "assault", value: 2 }],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default laurentDuelist;
