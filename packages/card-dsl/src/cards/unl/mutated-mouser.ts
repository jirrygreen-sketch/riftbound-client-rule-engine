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
 * status 判定（cards/README.md 第 2 节）：judge-required。两个关键词的 KeywordDef 文件都已合入
 * （RIFT-81 的 Shield、RIFT-264 的 Tank），但整卡仍不可执行：
 * - 没有已合入的生产方把卡牌的 keyword 能力解析成 KeywordDef 展开并注册进图层（契约 3.5/3.7）：
 *   layers 只消费经 ResolveContext.addContinuous 注册的 ContinuousEffectSpec，CardProgram 的
 *   keyword 能力没有消费路径（rad/staunch-survivor、ogn/volibear-imposing 记录同一缺口）。
 * - 814.1.d 的 Defender designation 不是 ObjectSnapshot 特征（契约 3.8 的 combatRole 增补仍在
 *   RIFT-105 分支，未进 HEAD），因此即使展开落地，Shield 的“仅防守时 +2”也无法只在该身份下生效。
 * - 815.1.c 的战斗伤害分配不读取分配优先级要求：combat/base-combat-allocation.ts 明确写着
 *   "No Tank/Backline/other assignment-priority requirement is bound here"，Tank 的全部功能无处执行。
 * - layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，未识别的
 *   compare 条件按 true 处理，展开里的 designation 条件在真实图层计算中恒真（ogn/staunch-survivor 记录）。
 * 依赖：RIFT-91（layers-continuous 条件求值与卡牌接线）、契约 3.8 combatRole 落地、战斗伤害分配工作流（815）。
 * 不近似实现：不把 Shield 写成普通数值加算，也不把 Tank 写成静态数值。
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
    "两个关键词的展开文件都已合入（814 的 effects/keywords/Shield.ts、815 的 effects/keywords/Tank.ts），但整卡仍缺可执行路径：" +
    "(1) 没有生产方把卡牌 keyword 能力解析为 KeywordDef 展开并注册进图层（契约 3.5/3.7；layers 只消费 " +
    "ResolveContext.addContinuous 注册的 ContinuousEffectSpec，CardProgram keyword 无消费路径）。" +
    "(2) 814.1.d 的 Defender designation 不是 ObjectSnapshot 特征（契约 3.8 的 combatRole 增补仍在 RIFT-105 分支未进 HEAD），" +
    "Shield 的“当我是防守方 +2 [M]”无法只在该身份下生效；layers/engine.ts 的 conditionMatches 也不识别 compare 条件（按 true 处理），" +
    "展开里的 designation 条件在真实图层计算中会恒真。(3) 815.1.b/815.1.c 的战斗伤害分配不读取分配优先级要求：" +
    "combat/base-combat-allocation.ts 明确写着 “No Tank/Backline/other assignment-priority requirement is bound here”，Tank 的全部功能无处执行。" +
    "依赖：RIFT-91（layers-continuous 条件求值与卡牌接线）、契约 3.8 combatRole 落地、战斗伤害分配工作流（815）。不近似实现。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;

export default program;
