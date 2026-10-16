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
 * - 没有已合入的内核路径把卡牌的 keyword 能力解析到 KeywordDef 并接入图层
 *   （契约 3.5 / 3.7）；当前 src 中只有 registry.generated.ts 与其测试消费
 *   关键词注册表。
 * - 即使接线完成，已合入的 keywords/Assault.ts 展开仍不可执行：展开读
 *   `designation` 对象属性（契约 3.8 新增的 ObjectSnapshot.combatRole），
 *   而当前 interpreter 的 ObjectSnapshot 没有该特征；layers/engine.ts 的
 *   conditionMatches 也不识别 compare 条件（只认 always/never/type/
 *   has-tag/has-keyword，其余一律按 true），所以 attacker 条件在图层计算里
 *   不能生效也不能正确关闭。
 * 保留有依据的声明，执行证据写 test.todo，不近似实现。
 */
const daringPoro = {
  canonicalCardId: "card.hash-406baf0c2f39d1eb52f69f43bb251ddd06afca820b412de6486e3112ed87bb21",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Assault 关键词的可执行路径（CR 807.1.c / 807.1.d.1）：(1) 没有已合入的内核路径把卡牌的 keyword 能力解析到 " +
    "KeywordDef 并交给 layers 计算（契约 3.5 / 3.7；当前 src 中只有 registry.generated.ts 与其测试消费关键词注册表）；" +
    "(2) 已合入的 keywords/Assault.ts 展开依赖攻击者指定（展开读 designation 对象属性，即契约 3.8 的 " +
    "ObjectSnapshot.combatRole），而 interpreter 的 ObjectSnapshot 没有该特征，layers/engine.ts 的 conditionMatches " +
    "也不识别 compare 条件（只认 always/never/type/has-tag/has-keyword，其余按 true），attacker 条件在真实图层计算中恒真，" +
    "无法只在我攻击时 +1 Might。依赖：RIFT-81（Assault 关键词展开，声明部分已合入）、RIFT-91（layers-continuous 条件支持）、" +
    "RIFT-257（CardProgram 关键词/静态能力绑定）、契约 3.8 combatRole 落地。不近似实现。",
  abilities: [{ kind: "keyword", keyword: "assault" }],
  sourceText: "[Assault] (+1 :rb_might: while I'm an attacker.)"
} satisfies CardProgram;

export default daringPoro;
