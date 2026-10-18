import type { CardProgram } from "../../ir/index.js";

/**
 * Daring Poro (ogn-210-298) — Unit, Order, Poro.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-210-298):
 *   [Assault] (+1 :rb_might: while I'm an attacker.)
 *
 * 规则依据（CR v1.5）：
 * - 807.1 / 807.1.a：Assault 是被动能力关键词，出现在单位上。
 * - 807.1.b / 807.1.b.3：格式为 "Assault [X]"，省略 X 时按 1 处理。
 * - 807.1.c：功能上等于「While I am an attacker, I have +X [M]」。
 * - 807.1.d / 807.1.d.1：攻击者资格在 Combat 中获得，且只在维持该资格期间生效。
 * - 807.2：多个来源授予的 Assault 数值相加、合并为一个。
 * - 807.3：是否具有 Assault 是可读取的特征。
 *
 * 结构：整张卡只有关键词能力，按契约 3.1 / README 第 5 节写
 * `{ kind: "keyword", keyword: "assault" }`（印刷未写数值，省略 value；
 * 默认 1 由 keywords/Assault.ts 的 807.1.b.3 处理）。
 * 展开（continuous.might 静态效果 + attacker 条件）由 engine-core 的关键词
 * 注册表负责（RIFT-81 已合入 keywords/Assault.ts），卡牌程序不重复展开。
 *
 * status 判定（README 第 2 节）：
 * - CardProgram keyword expansion and static binding are present. The remaining
 *   execution gap is in the production condition/combat path: Assault.ts still
 *   emits the legacy `designation` property, while the new expr-ext evaluator
 *   maps that spelling to ObjectSnapshot.combatRole but is not routed by the
 *   production static binder. CombatFlow also has not published attacker
 *   designations; the combat-start transaction remains blocked. The missing
 *   production adapter prevents this modifier from following the combat boundary.
 * 保留有依据的声明，执行证据写 test.todo，不近似实现。
 */
const daringPoro = {
  canonicalCardId: "card.hash-406baf0c2f39d1eb52f69f43bb251ddd06afca820b412de6486e3112ed87bb21",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault 的攻击者特征生产接线（CR 807.1.c/807.1.d/807.1.d.1）：" +
    "Assault.ts 仍生成读取 designation 的 compare 条件；expr-ext/evaluate.ts 虽已把 designation 映射到 " +
    "ObjectSnapshot.combatRole，programs/statics.ts 的生产条件回调仍走基础 evaluator，未接入该扩展。" +
    "同时 combat/flow.ts 的 combat-start-transaction 仍阻塞，尚未发布攻击者角色的进入/退出变化；" +
    "因此 +1 Might 不能随真实 Combat 边界生效与失效。",
  abilities: [{ kind: "keyword", keyword: "assault" }],
  sourceText: "[Assault] (+1 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default daringPoro;
