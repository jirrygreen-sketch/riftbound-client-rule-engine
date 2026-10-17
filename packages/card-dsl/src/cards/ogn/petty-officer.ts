import type { CardProgram } from "../../ir/index.js";

/**
 * Petty Officer (ogn-215-298) — Unit, Order, Pirate/Bilgewater.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-215-298):
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
 * 注册表负责，卡牌程序不重复展开。
 *
 * status 判定（README 第 2 节）：
 * - KeywordDef、continuous.might 展开与 CardProgram keyword 生命周期绑定已经合入。
 * - 展开仍不可在生产图层中忠实执行：它读取 "designation"，而契约快照字段是
 *   combatRole；同时 layers/engine.ts 的 conditionMatches 不消费 compare/object-property
 *   条件，未知条件会按 true 处理，攻击者条件因此无法正确关闭。
 * 保留有依据的声明，执行证据覆盖已合入展开，不近似实现。
 */
const pettyOfficer = {
  canonicalCardId: "card.hash-2daf12389f3f2209c75815321b3f70aaadfe8d1f9e8cc4b3dd747c93c0f780dc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault 关键词的可执行路径（CR 807.1.c / 807.1.d.1）：展开依赖攻击者指定，" +
    "但它读取 designation，而契约快照字段是 combatRole；layers/engine.ts 的 conditionMatches 也不消费 " +
    "compare/object-property 条件，未知条件按 true 处理，attacker 条件在真实图层计算中会恒真，" +
    "无法只在我攻击时 +1 Might。依赖：生产快照的 combatRole 落地与图层条件求值。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "assault" }],
  sourceText: "[Assault] (+1 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default pettyOfficer;
