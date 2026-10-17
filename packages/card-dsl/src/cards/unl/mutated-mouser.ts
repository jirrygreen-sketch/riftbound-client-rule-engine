import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mutated Mouser (unl-036-219) — Unit, 2 Energy, Might 1, Calm, tags Cat/Bilgewater.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-036-219，逐字）：
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * 规则依据（CR v1.5）：
 * - [Shield 2]：814.1 的 Passive Ability 关键词；814.1.a 出现在单位上；814.1.b / 814.1.b.1 / .b.2
 *   规定印刷形式 "Shield [X]"，X 是 Shield Value（本卡为 2）；814.1.c 功能上等于「当我是防守方时
 *   +2 [M]」；814.1.d / 814.1.d.1 说明防守方身份在 Combat 中取得（461），Shield 只在维持该身份期间
 *   生效；814.2 说明多来源数值相加成一个 Shield Value；814.3 说明是否拥有该关键词是可读取特征。
 *   按契约 3.7 / README 第 5 节，卡文件只声明 `{ kind: "keyword", keyword: "shield", value: 2 }`，
 *   展开（static continuous.might + designation 条件）由 effects/keywords/Shield.ts 负责。
 * - [Tank]：815.1 的 Passive Ability 关键词；815.1.a 出现在单位上；815.1.b 功能上等于「我必须比同控制者、
 *   没有 [Tank] 的单位更早被分配致命伤害」；815.1.c / 815.1.c.1 / 815.1.c.2 改写战斗伤害分配顺序；
 *   815.2 多实例冗余；815.3 是可读取特征。同样只声明关键词，展开（continuous.combat 分配要求）
 *   由 effects/keywords/Tank.ts 负责。括号内是提醒文本（135.2.d.3 无游戏功能），本文件不重复实现。
 *
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */
const abilities: Ability[] = [
  // 814.1.b.2：印刷的 Shield Value 是 2（该值由 keywords/Shield.ts 展开，卡内不重写）。
  { kind: "keyword", keyword: "shield", value: 2 },
  // 815.1.b：Tank 不带数值（815.2 多实例冗余）。
  { kind: "keyword", keyword: "tank" }
];

const program = {
  canonicalCardId:
    "card.hash-772d03e9b0b696718afe836a8028877765e2a10ff2fd39781dc7d52e3b05e8b8",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Shield 展开的 designation 到 ObjectSnapshot.combatRole 映射（814.1.d/814.1.d.1）：programs/statics.ts 已将 compare 条件包装为 conditionMatches 可调用的函数，" +
    "但 object-property(self, designation) 读取不存在的字段，静态绑定器捕获 MissingInformation 后返回 false；不是所有身份都无条件 +2 Might。" +
    "战斗角色事务仍在 combat/flow.ts 的 combat-start-transaction 阻塞（466.2）；Tank 的 continuous.combat 没有战斗伤害分配消费方，base-combat-allocation.ts 仍不绑定优先级要求（815.1.b/815.1.c）。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;

export default program;
