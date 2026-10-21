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
 * 仍缺（实测复核 2026-10-21）：Assault 的 designation 求值已接入默认表达式
 * 路径；一个 combatRole 已是 attacker 的独立快照经 createProgramBinding 与生产
 * createEngineStaticBinder 绑定后，Might 正确从印刷值 3 变为 5，defender/无角色
 * 保持 3。但真实 CombatFlow 把 designation 写入私有 combatRoles，并在
 * combat/flow.ts:196-200 构造角色视图；该视图没有成为 ChainEngine 的持久宿主
 * 视图。ChainEngine.pipeline.onEvent 在 chain/engine.ts:414-416 每次从
 * host.objects() 重置图层，而静态条件在 programs/static-adapters/model.ts:256-288
 * 也从同一 base host 重新读取 source。结果是 combat/flow.ts:289-304 虽已指定
 * attack/defender，flow.combat.snapshot(...).combatRole 为 attacker 时，默认图层
 * 求值仍是 3，攻击期间 +2 不生效。
 *
 * 依赖：engine-core 必须把 CombatFlow 的权威角色投影接入 LayerEngine 与静态条件
 * 的 source 视图（CR 466.2.c.3、807.1.d.1）。
 */
const laurentDuelist = {
  canonicalCardId: "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "实测（2026-10-21）Assault 的 KeywordDef（effects/keywords/Assault.ts，807.1.c）和 designation 默认求值已合入：" +
    "combatRole=attacker 的独立源快照经 createProgramBinding + createEngineStaticBinder 从印刷 Might 3 得到 5，" +
    "defender/无角色均为 3。剩余缺口在生产角色投影：CombatFlow 将 designation 保存在私有 combatRoles，并在 " +
    "combat/flow.ts:196-200 通过 layerObjects() 派生角色视图，但 ChainEngine.pipeline.onEvent 在 " +
    "chain/engine.ts:414-416 用 host.objects() 重置图层；静态条件在 programs/static-adapters/model.ts:256-288 " +
    "也从同一 base host 重新读取 source。故 combat/flow.ts:289-304 已完成 attacker/defender 指定、" +
    "flow.combat.snapshot(...).combatRole 为 attacker 时，默认图层仍算出 Might 3，+2 在真实攻击期间不生效。" +
    "需由 engine-core 把 CombatFlow 的权威战斗角色投影接入静态条件与层对象视图（CR 466.2.c.3、807.1.d.1）。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "assault", value: 2 }],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default laurentDuelist;
