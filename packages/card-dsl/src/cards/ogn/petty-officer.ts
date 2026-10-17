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
 * - 展开仍不可在生产图层中忠实执行：它读取 "designation"，而实际快照字段是
 *   combatRole。programs/statics.ts 已用 evaluateCondition 求值 compare/object-property，
 *   缺失 designation 时捕获异常并返回 false，因此攻击者也未获得 Assault 加成。
 *   缺口是关键词条件与实际战斗指定字段未接通，不是条件求值器缺失。
 * 保留有依据的声明，执行证据覆盖已合入展开，不近似实现。
 */
const pettyOfficer = {
  canonicalCardId: "card.hash-2daf12389f3f2209c75815321b3f70aaadfe8d1f9e8cc4b3dd747c93c0f780dc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault 条件与实际战斗指定的字段接线（CR 807.1.c / 807.1.d.1）：展开的 compare/object-property " +
    "读取 designation，而生产快照已提供 combatRole。programs/statics.ts 的 evaluateCondition 已执行该条件，" +
    "但缺失 designation 时捕获异常并返回 false，因此攻击者也未获得 +1 Might；非攻击者没有加成。" +
    "依赖：Assault 的 designation 条件与实际 combatRole 的映射。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "assault" }],
  sourceText: "[Assault] (+1 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default pettyOfficer;
